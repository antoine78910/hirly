import { startApplication } from "./app";

const application = await startApplication();
let stopping = false;

const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(
    JSON.stringify({
      service: "hirly-worker",
      version: "0.1.0",
      environment: application.config.NODE_ENV,
      event: "worker.shutdown",
      severity: "info",
      details: { signal },
    }),
  );
  await application.stop();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
