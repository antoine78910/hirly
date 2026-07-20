import { createJsonLogger } from "@hirly/observability";
import { createDatabase, WorkerRepository } from "@hirly/db";
import { parseRuntimeConfig } from "./runtime/config";
import { PostgresRuntimeStore } from "./runtime/store";
import { createTaskHandlers } from "./runtime/handlers";
import { Consumer } from "./runtime/consumer";
import { Scheduler } from "./runtime/scheduler";
import { startHttpServer } from "./http/server";

export async function startApplication(
  environment: Record<string, string | undefined> = process.env,
) {
  const config = parseRuntimeConfig(environment);
  const sql = createDatabase(config.JOBS_DATABASE_URL, {
    max: Math.max(4, config.WORKER_CONCURRENCY + 2),
  });
  const repository = new WorkerRepository(sql);
  const store = new PostgresRuntimeStore(sql, repository);
  const logger = createJsonLogger();
  const health = { ready: false };
  const consumer = new Consumer(
    repository,
    createTaskHandlers(store),
    logger,
    {
      concurrency: config.WORKER_CONCURRENCY,
      leaseSeconds: config.WORKER_LEASE_SECONDS,
      heartbeatSeconds: config.WORKER_HEARTBEAT_SECONDS,
      pollMs: config.WORKER_POLL_MS,
      instanceId: config.WORKER_INSTANCE_ID,
      serviceVersion: "0.1.0",
      environment: config.NODE_ENV,
    },
  );
  const scheduler = new Scheduler(store, logger, {
    pollMs: config.WORKER_SCHEDULE_POLL_MS,
    serviceVersion: "0.1.0",
    environment: config.NODE_ENV,
  });
  const server = startHttpServer({
    config,
    queue: repository,
    store,
    logger,
    health,
  });
  await repository.ping();
  consumer.start();
  scheduler.start();
  health.ready = true;

  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= (async () => {
      health.ready = false;
      server.stop(false);
      await scheduler.stop();
      await consumer.stop(config.WORKER_SHUTDOWN_MS);
      await repository.close();
    })());

  return { config, server, consumer, scheduler, health, stop };
}
