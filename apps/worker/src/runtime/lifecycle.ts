export interface ConsumerComponent {
  start(): void;
  stop(timeoutMs: number): Promise<void>;
}

export interface SchedulerComponent {
  start(): void;
  stop(): Promise<void>;
}

export interface HttpComponent {
  stop(closeActiveConnections?: boolean): void;
}

export interface ClosableRepository {
  close(): Promise<void>;
}

export function createWorkerRuntime(input: {
  health: { ready: boolean };
  consumer: ConsumerComponent;
  scheduler: SchedulerComponent;
  server: HttpComponent;
  repository: ClosableRepository;
  shutdownMs: number;
}) {
  let stopping: Promise<void> | undefined;
  return {
    start() {
      input.consumer.start();
      input.scheduler.start();
      input.health.ready = true;
    },
    stop() {
      return (stopping ??= (async () => {
        input.health.ready = false;
        input.server.stop(false);
        await input.scheduler.stop();
        await input.consumer.stop(input.shutdownMs);
        await input.repository.close();
      })());
    },
  };
}
