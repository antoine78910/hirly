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

export function createTaskHandlers(
  store: RuntimeStore,
  logger?: Logger,
  modules: Record<Provider, ProviderCore<unknown>> = providerModules,
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
        let rateGate = rateGates.get(provider);
        if (!rateGate) {
          rateGate = new ProviderRateGate(module.rateLimit);
          rateGates.set(provider, rateGate);
        }
        const request = providerSearchRequestSchema.parse({
          provider,
          ...task.payload,
        });
        if (!store.writeJobsAndComplete) {
          throw new IngestionError(
            "integrity_error",
            "canonical writer is unavailable",
          );
        }
        const writeJobsAndComplete = store.writeJobsAndComplete.bind(store);
        const result = await runIngestion({
          provider,
          transport: module.transport,
          adapter: module.adapter,
          repository: {
            async upsertCanonicalBatch(jobs) {
              const current = await writeJobsAndComplete(task, jobs);
              if (!current) {
                throw new IngestionError(
                  "integrity_error",
                  "lease lost before canonical batch write",
                );
              }
              return jobs.length;
            },
          },
          request,
          rateLimit: module.rateLimit,
          rateGate,
          signal,
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
        if (result.jobs.length > 0) return { taskCompleted: true };
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
