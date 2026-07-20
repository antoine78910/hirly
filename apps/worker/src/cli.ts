import { enqueueRunSchema, providerSchema } from "@hirly/contracts";
import { createDatabase, WorkerRepository } from "@hirly/db";
import { parseRuntimeConfig } from "./runtime/config";
import { PostgresRuntimeStore } from "./runtime/store";
import type { Enqueuer, RuntimeStore } from "./runtime/types";
import { assertProviderTransportActive } from "./providers";

function usage(): never {
  throw new Error(
    "usage: bun run cli enqueue-maintenance <idempotency-key> | enqueue-provider <provider> <idempotency-key> | run-status <uuid>",
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
      kind: "inventory_maintenance",
      provider: null,
      idempotencyKey: first,
      triggerSource: "cli",
      tasks: [
        {
          taskKey: "inventory-maintenance",
          taskType: "inventory.maintenance",
          payload: {},
        },
      ],
    });
    console.log(JSON.stringify({ runId: await repository.enqueue(input) }));
  } else if (command === "enqueue-provider" && first && second) {
    const provider = providerSchema.parse(first);
    await store.assertProviderRunnable(provider);
    const input = enqueueRunSchema.parse({
      kind: "provider_ingestion",
      provider,
      idempotencyKey: second,
      triggerSource: "cli",
      tasks: [
        {
          taskKey: `${provider}:first-page`,
          taskType: "provider.fetch_page",
          payload: {},
        },
      ],
    });
    console.log(JSON.stringify({ runId: await repository.enqueue(input) }));
  } else if (command === "run-status" && first) {
    console.log(JSON.stringify({ run: await store.getRun(first) }));
  } else {
    usage();
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
