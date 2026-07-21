import { createJsonLogger } from "@hirly/observability";
import {
  createDatabase,
  JobProjectionRepository,
  WorkerRepository,
} from "@hirly/db";
import { parseRuntimeConfig } from "./runtime/config";
import {
  PostgresJobProjectionStore,
  PostgresRuntimeStore,
} from "./runtime/store";
import { createTaskHandlers } from "./runtime/handlers";
import { Consumer } from "./runtime/consumer";
import { Scheduler } from "./runtime/scheduler";
import { startHttpServer } from "./http/server";
import { createWorkerRuntime } from "./runtime/lifecycle";
import { JobProjectionConsumer } from "./runtime/job-projection-consumer";

export async function startApplication(
  environment: Record<string, string | undefined> = process.env,
) {
  const config = parseRuntimeConfig(environment);
  const sql = createDatabase(config.JOBS_DATABASE_URL, {
    max: Math.max(4, config.WORKER_CONCURRENCY + 2),
  });
  const repository = new WorkerRepository(sql);
  const projectionRepository = new JobProjectionRepository(sql);
  const store = new PostgresRuntimeStore(repository);
  const logger = createJsonLogger();
  const health = { ready: false };
  const consumer = new Consumer(
    repository,
    createTaskHandlers(store, logger),
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
  const projectionConsumer = new JobProjectionConsumer(
    new PostgresJobProjectionStore(projectionRepository),
    {
      enabled: config.JOB_PROJECTION_ENABLED,
      reconciliationEnabled: config.PROJECTION_RECONCILIATION_ENABLED,
      instanceId: config.WORKER_INSTANCE_ID,
      concurrency: config.WORKER_CONCURRENCY,
      batchSize: config.JOB_PROJECTION_BATCH_SIZE,
      leaseSeconds: config.WORKER_LEASE_SECONDS,
      heartbeatSeconds: config.WORKER_HEARTBEAT_SECONDS,
      pollMs: config.WORKER_POLL_MS,
      reconciliationBatchSize:
        config.JOB_PROJECTION_RECONCILIATION_BATCH_SIZE,
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
  const runtime = createWorkerRuntime({
    health,
    consumer,
    projectionConsumer,
    scheduler,
    server,
    repository,
    shutdownMs: config.WORKER_SHUTDOWN_MS,
  });
  runtime.start();

  return {
    config,
    server,
    consumer,
    projectionConsumer,
    scheduler,
    health,
    stop: runtime.stop,
  };
}
