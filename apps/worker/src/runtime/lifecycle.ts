export interface ConsumerComponent {
  start(): void;
  stopClaiming(): void;
  stop(timeoutMs: number): Promise<void>;
}

export interface SchedulerComponent {
  start(): void;
  stop(): Promise<void>;
}

export interface HttpComponent {
  stop(closeActiveConnections?: boolean): Promise<void>;
}

export interface ClosableRepository {
  close(): Promise<void>;
}

export function createWorkerRuntime(input: {
  health: { ready: boolean };
  consumer: ConsumerComponent;
  projectionConsumer?: ConsumerComponent;
  scheduler: SchedulerComponent;
  server: HttpComponent;
  repository: ClosableRepository;
  shutdownMs: number;
}) {
  let stopping: Promise<void> | undefined;
  return {
    start() {
      input.consumer.start();
      input.projectionConsumer?.start();
      input.scheduler.start();
      input.health.ready = true;
    },
    stop() {
      if (!stopping) {
        stopping = (async () => {
          input.health.ready = false;
          input.consumer.stopClaiming();
          input.projectionConsumer?.stopClaiming();
          await Promise.all([input.server.stop(false), input.scheduler.stop()]);
          await Promise.all([
            input.consumer.stop(input.shutdownMs),
            input.projectionConsumer?.stop(input.shutdownMs),
          ]);
          await input.repository.close();
        })();
      }
      return stopping;
    },
  };
}
