import { enqueueRunSchema, providerSchema } from "@hirly/contracts";
import { createDatabase, WorkerRepository } from "@hirly/db";
import { parseRuntimeConfig } from "./runtime/config";
import { PostgresRuntimeStore } from "./runtime/store";

function usage(): never {
  throw new Error(
    "usage: bun run cli enqueue-maintenance <idempotency-key> | enqueue-provider <provider> <idempotency-key> | run-status <uuid>",
  );
}

const config = parseRuntimeConfig(process.env);
const sql = createDatabase(config.JOBS_DATABASE_URL);
const repository = new WorkerRepository(sql);
const store = new PostgresRuntimeStore(sql, repository);

try {
  const [command, first, second] = process.argv.slice(2);
  if (command === "enqueue-maintenance" && first) {
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
} finally {
  await repository.close();
}
