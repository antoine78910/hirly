import { startApplication } from "./app";

interface ShutdownApplication {
  config: { NODE_ENV: string };
  stop(): Promise<void>;
}

export function createShutdownHandler(input: {
  application: ShutdownApplication;
  write?: (line: string) => void;
  exit?: (code: number) => void;
}) {
  const write = input.write ?? ((line: string) => console.log(line));
  const exit = input.exit ?? ((code: number) => process.exit(code));
  let stopping: Promise<void> | undefined;

  return (signal: "SIGTERM" | "SIGINT"): Promise<void> =>
    (stopping ??= (async () => {
      write(
        JSON.stringify({
          service: "hirly-worker",
          version: "0.1.0",
          environment: input.application.config.NODE_ENV,
          event: "worker.shutdown",
          severity: "info",
          details: { signal },
        }),
      );
      try {
        await input.application.stop();
        exit(0);
      } catch {
        write(
          JSON.stringify({
            service: "hirly-worker",
            version: "0.1.0",
            environment: input.application.config.NODE_ENV,
            event: "worker.shutdown_failed",
            severity: "error",
            reasonCode: "shutdown_failed",
          }),
        );
        exit(1);
      }
    })());
}

if (import.meta.main) {
  const application = await startApplication();
  const shutdown = createShutdownHandler({ application });
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
