import type { TaskHandlers, RuntimeStore } from "./types";
import { PermanentTaskError } from "./retry";
import {
  providerSchema,
  providerSearchRequestSchema,
  type Provider,
} from "@hirly/contracts";
import type { Logger } from "@hirly/observability";
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

function environmentSproutSecretResolver(): SproutSecretResolver {
  return {
    async resolve(reference) {
      if (reference !== "secret://sprout/france-api") {
        throw new IngestionError("authorization_blocked", "sprout_credential_reference_rejected");
      }
      const value = process.env.SPROUT_FRANCE_API_TOKEN?.trim();
      if (!value) {
        throw new IngestionError("authorization_blocked", "sprout_credential_unavailable");
      }
      return value;
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
              fetch: options.sproutFetch,
              maxResponseBytes: payload.maxResponseBytes,
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
                return result;
              },
            });
            await runSproutPageTask<SproutRawJob>({
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
                incrementalEnabled: payload.mode === "incremental",
                backfillEnabled: payload.mode === "backfill",
                providerCountryKillSwitch: false,
                sourceCountryKillSwitch: false,
                canaryEvidence: runtime.canaryEvidence ?? {
                  status: "pending",
                  evidenceRef: null,
                  pagesCommitted: 0,
                  identityReadBack: false,
                  rawSnapshotLinked: false,
                  occurrenceLinked: false,
                  checkpointReadBack: false,
                  singleWriterVerified: false,
                },
                rollbackEvidence: runtime.rollbackEvidence ?? {
                  status: "pending",
                  evidenceRef: null,
                  providerKillSwitchVerified: false,
                  sourceKillSwitchVerified: false,
                  scheduleDisableVerified: false,
                  transportDisableVerified: false,
                  outstandingTasksStopVerified: false,
                  writerClaimReleaseVerified: false,
                },
              },
              mode: payload.mode,
              checkpoint,
              transport,
              repository,
              hasFranceLocation: hasSproutFranceLocation,
              signal: claimAbort.signal,
              maxResponseBytes: payload.maxResponseBytes,
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
