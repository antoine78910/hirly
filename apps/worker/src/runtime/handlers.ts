import type { TaskHandlers, RuntimeStore } from "./types";
import { PermanentTaskError, safeErrorMessage } from "./retry";
import {
  providerSchema,
  providerSearchRequestSchema,
  enqueueRunSchema,
  type Provider,
} from "@hirly/contracts";
import type { Logger } from "@hirly/observability";
import type { ClaimedTask } from "@hirly/db";
import {
  IngestionError,
  ProviderRateGate,
  runIngestion,
} from "@hirly/ingestion";
import {
  getProviderModule,
  providerModules,
} from "../providers";
import type { ProviderCore } from "../providers/core";
import {
  SPROUT_FRANCE_DISABLED_REGISTRATION,
  SproutHttpTransport,
  createSproutCommitRepository,
  hasSproutFranceLocation,
  runSproutPageTask,
  sproutCheckpointSchema,
  sproutTaskPayloadSchema,
  type SproutRawJob,
  type SproutSecretResolver,
} from "../providers/sprout";

function emitSproutOperation(
  logger: Logger | undefined,
  task: ClaimedTask,
  input: {
    event: string;
    severity: "debug" | "info" | "warn" | "error";
    outcome?: string;
    reasonCode?: string;
    details?: Record<string, unknown>;
  },
): void {
  try {
    logger?.emit({
      service: "hirly-worker",
      version: "0.1.0",
      environment: process.env.NODE_ENV ?? "development",
      event: input.event,
      severity: input.severity,
      runId: task.runId,
      taskId: task.taskId,
      taskType: task.taskType,
      provider: "sprout",
      attempt: task.attempts,
      maxAttempts: task.maxAttempts,
      outcome: input.outcome,
      reasonCode: input.reasonCode,
      details: input.details,
    });
  } catch {
    // Logging failures must not affect the authoritative provider writer.
  }
}

function environmentSproutSecretResolver(): SproutSecretResolver {
  return {
    async resolve(reference) {
      if (reference !== "secret://sprout/france-api") {
        throw new IngestionError("authorization_blocked", "sprout_credential_reference_rejected");
      }
      const accessToken = process.env.SPROUT_FRANCE_API_TOKEN?.trim();
      const refreshToken = process.env.SPROUT_FRANCE_REFRESH_TOKEN?.trim();
      if (!accessToken || !refreshToken) {
        throw new IngestionError("authorization_blocked", "sprout_credential_unavailable");
      }
      return { accessToken, refreshToken };
    },
  };
}

function environmentSproutTokenRefresher() {
  return {
    async refresh(refreshToken: string, signal: AbortSignal) {
      const apiKey = process.env.SPROUT_SUPABASE_ANON_KEY?.trim();
      if (!apiKey) throw new Error("sprout_refresh_api_key_unavailable");
      const response = await fetch(
        "https://qxkswyqmsisjdtmywnow.supabase.co/auth/v1/token?grant_type=refresh_token",
        {
          method: "POST",
          headers: { apikey: apiKey, authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
          signal,
        },
      );
      if (!response.ok) throw new Error("sprout_refresh_rejected");
      const body = (await response.json()) as { access_token?: string; refresh_token?: string };
      if (!body.access_token || !body.refresh_token) throw new Error("sprout_refresh_response_invalid");
      return { accessToken: body.access_token, refreshToken: body.refresh_token };
    },
  };
}

export function createTaskHandlers(
  store: RuntimeStore,
  logger?: Logger,
  modules: Record<Provider, ProviderCore<unknown>> = providerModules,
  options: {
    providerClaimHeartbeatMs?: number;
    sproutAllowedOrigins?: readonly string[];
    sproutSecretResolver?: SproutSecretResolver;
    sproutFetch?: typeof globalThis.fetch;
  } = {},
): TaskHandlers {
  const rateGates = new Map<Provider, ProviderRateGate>();
  return {
    "inventory.maintenance": async (_task, signal) => {
      signal.throwIfAborted();
    },
    "provider.fetch_page": async (task, signal) => {
      signal.throwIfAborted();
      if (!task.provider) {
        throw new PermanentTaskError(
          "invalid_input",
          "provider task is missing provider",
        );
      }
      const provider = providerSchema.parse(task.provider);
      try {
        await store.assertProviderRunnable(provider);
        const module = modules[provider] ?? getProviderModule(provider);
        if (
          !store.claimProviderWork ||
          !store.heartbeatProviderWork ||
          !store.finishProviderWork ||
          !store.releaseProviderWork ||
          !store.writeJobsAndComplete
        ) {
          throw new IngestionError(
            "integrity_error",
            "provider ownership claim lifecycle is unavailable",
          );
        }
        const leaseSeconds = Math.max(
          1,
          Math.ceil((task.leaseUntil.getTime() - Date.now()) / 1_000),
        );
        const providerClaim = await store.claimProviderWork(
          task,
          provider,
          leaseSeconds,
        );
        const heartbeatProviderWork = store.heartbeatProviderWork.bind(store);
        const finishProviderWork = store.finishProviderWork.bind(store);
        const releaseProviderWork = store.releaseProviderWork.bind(store);
        const writeJobsAndComplete = store.writeJobsAndComplete.bind(store);
        const claimAbort = new AbortController();
        const forwardAbort = () => claimAbort.abort(signal.reason);
        signal.addEventListener("abort", forwardAbort, { once: true });
        let claimCompleted = false;
        let claimCompleting = false;
        let heartbeatPromise: Promise<void> | null = null;
        let heartbeatError: IngestionError | null = null;
        const heartbeatMs =
          options.providerClaimHeartbeatMs ??
          Math.max(250, Math.floor((leaseSeconds * 1_000) / 3));
        const heartbeat = setInterval(async () => {
          if (
            heartbeatPromise ||
            claimCompleting ||
            claimCompleted ||
            heartbeatError
          ) return;
          heartbeatPromise = (async () => {
            try {
              const current = await heartbeatProviderWork(
                  task,
                  providerClaim,
                  leaseSeconds,
                );
              if (claimCompleted) return;
              if (!current) {
                heartbeatError = new IngestionError(
                  "integrity_error",
                  "provider ownership claim became stale",
                );
                claimAbort.abort(heartbeatError);
              }
            } catch {
              if (claimCompleted) return;
              heartbeatError = new IngestionError(
                "integrity_error",
                "provider ownership claim heartbeat failed",
              );
              claimAbort.abort(heartbeatError);
            } finally {
              heartbeatPromise = null;
            }
          })();
          await heartbeatPromise;
        }, heartbeatMs);
        try {
          if (provider === "sprout") {
            if (!store.getSproutSourceRuntime || !store.commitSproutSourcePage) {
              throw new IngestionError(
                "integrity_error",
                "Sprout source runtime persistence is unavailable",
              );
            }
            const payload = sproutTaskPayloadSchema.parse(task.payload);
            const runtime = await store.getSproutSourceRuntime(
              payload.sourceId,
              payload.mode,
            );
            if (!runtime) {
              throw new IngestionError(
                "authorization_blocked",
                "sprout_source_activation_blocked",
              );
            }
            const checkpoint = sproutCheckpointSchema.parse(runtime.checkpoint);
            const configuredOrigins =
              options.sproutAllowedOrigins ??
              (process.env.SPROUT_ALLOWED_ORIGIN
                ? [process.env.SPROUT_ALLOWED_ORIGIN]
                : []);
            if (configuredOrigins.length === 0) {
              throw new IngestionError(
                "authorization_blocked",
                "sprout_transport_allowlist_missing",
              );
            }
            const transport = new SproutHttpTransport({
              endpoint: runtime.endpoint,
              allowedOrigins: configuredOrigins,
              secrets: options.sproutSecretResolver ?? environmentSproutSecretResolver(),
              tokenRefresher: environmentSproutTokenRefresher(),
              fetch: options.sproutFetch,
              maxResponseBytes: payload.maxResponseBytes,
              onOperation(operation) {
                if (operation.type === "fetch_response") {
                  emitSproutOperation(logger, task, {
                    event: "sprout.fetch_response",
                    severity: "info",
                    outcome: "succeeded",
                    details: operation,
                  });
                  return;
                }
                emitSproutOperation(logger, task, {
                  event: "sprout.retry_backoff",
                  severity: "warn",
                  outcome: "retrying",
                  reasonCode: operation.classification,
                  details: operation,
                });
              },
            });
            const commitSproutSourcePage = store.commitSproutSourcePage.bind(store);
            const repository = createSproutCommitRepository({
              sourceId: runtime.sourceId,
              policyId: runtime.policyId,
              countryCode: "FR",
              mode: payload.mode,
              async commit(commit) {
                claimCompleting = true;
                await heartbeatPromise;
                if (heartbeatError) throw heartbeatError;
                const result = await commitSproutSourcePage(
                  task,
                  providerClaim,
                  commit,
                );
                claimCompleted = true;
                emitSproutOperation(logger, task, {
                  event: "sprout.page_committed",
                  severity: "info",
                  outcome: "succeeded",
                  details: {
                    mode: payload.mode,
                    itemCount: commit.entries.length,
                    complete: commit.complete,
                    checkpointInOffset: commit.checkpointIn.offset,
                    checkpointOutOffset: commit.checkpointOut.offset,
                    pageSize: commit.checkpointOut.pageSize,
                    observedTotal: commit.checkpointOut.observedTotal,
                    snapshotsInserted: result.snapshotsInserted,
                    canonicalUpserts: result.canonicalUpserts,
                    occurrencesUpserted: result.occurrencesUpserted,
                    groupsCreated: result.groupsCreated,
                    listingCounts: {
                      fetched: commit.entries.length,
                      added: result.canonicalUpserts,
                      ignored: Math.max(0, commit.entries.length - result.canonicalUpserts),
                      errors: 0,
                    },
                  },
                });
                return result;
              },
            });
            emitSproutOperation(logger, task, {
              event: "sprout.page_start",
              severity: "info",
              outcome: "started",
              details: {
                mode: payload.mode,
                countryCode: "FR",
                checkpointOffset: checkpoint.offset,
                pageSize: checkpoint.pageSize,
              },
            });
            const result = await runSproutPageTask<SproutRawJob>({
              activation: {
                ...SPROUT_FRANCE_DISABLED_REGISTRATION,
                authorizationStatus: "authorized",
                writerRuntime: "typescript",
                policyStatus: "approved",
                policyEvidenceRef: runtime.policyEvidenceRef,
                redisplayAllowed: true,
                fullTextRetentionAllowed: true,
                credentialRef: runtime.credentialRef,
                approvedPageSize: runtime.approvedPageSize,
                enabled: true,
                transportEnabled: true,
                canaryEnabled: payload.mode === "canary",
                incrementalEnabled: payload.mode === "incremental",
                backfillEnabled: payload.mode === "backfill",
                providerCountryKillSwitch: false,
                sourceCountryKillSwitch: false,
                canaryEvidence: runtime.canaryEvidence,
                rollbackEvidence: runtime.rollbackEvidence,
              },
              mode: payload.mode,
              checkpoint,
              transport,
              repository,
              hasFranceLocation: hasSproutFranceLocation,
              signal: claimAbort.signal,
              maxResponseBytes: payload.maxResponseBytes,
            });
            if (!result.complete) {
              const nextOffset = result.checkpoint.offset;
              const nextRunId = await store.enqueue(enqueueRunSchema.parse({
                kind: "provider_ingestion",
                provider: "sprout",
                idempotencyKey: `sprout:${payload.sourceId}:${payload.mode}:${nextOffset}`,
                triggerSource: "cli",
                tasks: [{
                  taskKey: `sprout:france:${payload.mode}:${payload.sourceId}:${nextOffset}`,
                  taskType: "provider.fetch_page",
                  payload,
                }],
              }));
              await store.attachCareerSource?.(nextRunId, payload.sourceId);
            }
            emitSproutOperation(logger, task, {
              event: "sprout.page_complete",
              severity: "info",
              outcome: "succeeded",
              details: {
                mode: payload.mode,
                fetched: result.fetched,
                responseBytes: result.responseBytes,
                complete: result.complete,
                checkpointOffset: result.checkpoint.offset,
                pageSize: result.checkpoint.pageSize,
                observedTotal: result.checkpoint.observedTotal,
                listingCounts: {
                  fetched: result.fetched,
                  added: result.fetched,
                  ignored: 0,
                  errors: 0,
                },
              },
            });
            return { taskCompleted: true };
          }
          let rateGate = rateGates.get(provider);
          if (!rateGate) {
            rateGate = new ProviderRateGate(module.rateLimit);
            rateGates.set(provider, rateGate);
          }
          const request = providerSearchRequestSchema.parse({
            provider,
            ...task.payload,
          });
          const result = await runIngestion({
            provider,
            transport: module.transport,
            adapter: module.adapter,
            repository: {
              async upsertCanonicalBatch(jobs) {
                claimCompleting = true;
                await heartbeatPromise;
                if (heartbeatError) throw heartbeatError;
                const current = await writeJobsAndComplete(
                  task,
                  providerClaim,
                  jobs,
                );
                if (!current) {
                  throw new IngestionError(
                    "integrity_error",
                    "lease lost before canonical batch write",
                  );
                }
                claimCompleted = true;
                return jobs.length;
              },
            },
            request,
            rateLimit: module.rateLimit,
            rateGate,
            signal: claimAbort.signal,
            onMetrics(metrics) {
              try {
                logger?.emit({
                  service: "hirly-worker",
                  version: "0.1.0",
                  environment: process.env.NODE_ENV ?? "development",
                  event: "provider.ingestion_batch",
                  severity: "info",
                  runId: task.runId,
                  taskId: task.taskId,
                  taskType: task.taskType,
                  provider,
                  attempt: task.attempts,
                  maxAttempts: task.maxAttempts,
                  durationsMs: {
                    queueWait: 0,
                    fetch: metrics.durationsMs.fetch,
                    normalization: metrics.durationsMs.normalization,
                    validation: metrics.durationsMs.validation,
                    database: metrics.durationsMs.database,
                    total: metrics.durationsMs.total,
                  },
                  counts: {
                    fetched: metrics.fetched,
                    accepted: metrics.accepted,
                    rejected: metrics.rejected,
                    deduplicated: metrics.deduplicated,
                    upserted: metrics.upserted,
                  },
                  outcome: "succeeded",
                });
              } catch {
                // The canonical write completed atomically with the task. A
                // metrics sink failure must not turn that success into a retry.
              }
            },
          });
          if (heartbeatError) throw heartbeatError;
          if (result.jobs.length === 0) {
            claimCompleting = true;
            await heartbeatPromise;
            if (heartbeatError) throw heartbeatError;
            if (!(await finishProviderWork(task, providerClaim))) {
              throw new IngestionError(
                "integrity_error",
                "lease lost before empty provider run completion",
              );
            }
            claimCompleted = true;
          }
          return { taskCompleted: true };
        } finally {
          clearInterval(heartbeat);
          signal.removeEventListener("abort", forwardAbort);
          await heartbeatPromise;
          if (!claimCompleted) {
            try {
              await releaseProviderWork(task, providerClaim);
            } catch {
              // Claim expiry/reaping remains the crash-safe fallback. Cleanup
              // failure must not replace the provider's original error.
            }
          }
        }
      } catch (error) {
        if (provider === "sprout") {
          emitSproutOperation(logger, task, {
            event: "sprout.page_terminal",
            severity: "error",
            outcome: "failed",
            reasonCode:
              error instanceof IngestionError ? error.code : "unexpected_error",
            details: {
              message: safeErrorMessage(error),
              listingCounts: { fetched: 0, added: 0, ignored: 0, errors: 1 },
            },
          });
        }
        if (
          error instanceof IngestionError ||
          (error instanceof Error && error.message === "authorization_blocked")
        ) {
          const code =
            error instanceof IngestionError
              ? error.code
              : "authorization_blocked";
          throw new PermanentTaskError(code, error.message);
        }
        throw error;
      }
    },
  };
}
