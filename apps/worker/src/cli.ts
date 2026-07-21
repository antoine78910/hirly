import {
  enqueueRunSchema,
  providerSchema,
  type Provider,
} from "@hirly/contracts";
import { createDatabase, WorkerRepository } from "@hirly/db";
import { parseRuntimeConfig } from "./runtime/config";
import { PostgresRuntimeStore } from "./runtime/store";
import type { Enqueuer, RuntimeStore } from "./runtime/types";
import { assertProviderTransportActive } from "./providers";

export type CliCommand =
  | { type: "enqueue-maintenance"; idempotencyKey: string }
  | { type: "enqueue-provider"; provider: Provider; idempotencyKey: string }
  | { type: "enqueue-sprout"; mode: "canary" | "backfill" | "incremental"; sourceId: string; idempotencyKey: string }
  | { type: "run-status"; runId: string };

export function parseCliArgs(args: string[]): CliCommand {
  const [command, first, second] = args;
  if (command === "enqueue-maintenance" && first && !second) {
    return { type: command, idempotencyKey: first };
  }
  if (command === "enqueue-provider" && first && second) {
    return {
      type: command,
      provider: providerSchema.parse(first),
      idempotencyKey: second,
    };
  }
  if (command === "enqueue-sprout" && first && second && args[3]) {
    if (first !== "canary" && first !== "backfill" && first !== "incremental") {
      throw new Error("sprout mode must be canary, backfill, or incremental");
    }
    return { type: command, mode: first, sourceId: second, idempotencyKey: args[3] };
  }
  if (
    command === "run-status" &&
    first &&
    /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(first)
  ) {
    return { type: command, runId: first };
  }
  throw new Error(
    "usage: enqueue-maintenance <idempotency-key> | enqueue-provider <provider> <idempotency-key> | enqueue-sprout <mode> <source-id> <idempotency-key> | run-status <uuid>",
  );
}

export async function runCli(
  command: CliCommand,
  dependencies: { queue: Enqueuer; store: RuntimeStore },
): Promise<Record<string, unknown>> {
  if (command.type === "run-status") {
    return { run: await dependencies.store.getRun(command.runId) };
  }
  if (command.type === "enqueue-provider") {
    await dependencies.store.assertProviderRunnable(command.provider);
    assertProviderTransportActive(command.provider);
    const input = enqueueRunSchema.parse({
      kind: "provider_ingestion",
      provider: command.provider,
      idempotencyKey: command.idempotencyKey,
      triggerSource: "cli",
      tasks: [
        {
          taskKey: `${command.provider}:first-page`,
          taskType: "provider.fetch_page",
          payload: {},
        },
      ],
    });
    return { runId: await dependencies.queue.enqueue(input) };
  }
  if (command.type === "enqueue-sprout") {
    await dependencies.store.assertProviderRunnable("sprout");
    assertProviderTransportActive("sprout");
    const input = enqueueRunSchema.parse({
      kind: "provider_ingestion",
      provider: "sprout",
      idempotencyKey: command.idempotencyKey,
      triggerSource: "cli",
      tasks: [{
        taskKey: `sprout:france:${command.mode}:${command.sourceId}`,
        taskType: "provider.fetch_page",
        payload: {
          sourceId: command.sourceId,
          mode: command.mode,
          maxResponseBytes: 2_000_000,
        },
      }],
    });
    return { runId: await dependencies.queue.enqueue(input) };
  }
  const input = enqueueRunSchema.parse({
    kind: "inventory_maintenance",
    provider: null,
    idempotencyKey: command.idempotencyKey,
    triggerSource: "cli",
    tasks: [
      {
        taskKey: "inventory-maintenance",
        taskType: "inventory.maintenance",
        payload: {},
      },
    ],
  });
  return { runId: await dependencies.queue.enqueue(input) };
}

async function main(): Promise<void> {
  const config = parseRuntimeConfig(process.env);
  const sql = createDatabase(config.JOBS_DATABASE_URL);
  const repository = new WorkerRepository(sql);
  const store = new PostgresRuntimeStore(repository);
  try {
    console.log(
      JSON.stringify(
        await runCli(parseCliArgs(process.argv.slice(2)), {
          queue: repository,
          store,
        }),
      ),
    );
  } finally {
    await repository.close();
  }
}

if (import.meta.main) {
  await main();
}
