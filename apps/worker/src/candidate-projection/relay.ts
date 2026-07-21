import type { CandidateProjector } from "@hirly/matching";
import type { Logger } from "@hirly/observability";

const sleep = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

export class CandidateProjectionRelay {
  private readonly controller = new AbortController();
  private runPromise: Promise<void> | null = null;

  constructor(
    private readonly projector: CandidateProjector,
    private readonly logger: Logger,
    private readonly options: {
      pollMs: number;
      batchSize: number;
      leaseSeconds: number;
      serviceVersion: string;
      environment: string;
    },
  ) {}

  start(): void {
    this.runPromise ??= this.run();
  }

  private async run(): Promise<void> {
    while (!this.controller.signal.aborted) {
      try {
        const result = await this.projector.runBatch(
          this.options.batchSize,
          this.options.leaseSeconds,
        );
        if (result.claimed > 0) {
          this.logger.emit({
            service: "hirly-worker",
            version: this.options.serviceVersion,
            environment: this.options.environment,
            event: "candidate_projection.batch",
            severity: result.missing > 0 ? "warn" : "info",
            details: { ...result },
          });
        }
      } catch (error) {
        this.logger.emit({
          service: "hirly-worker",
          version: this.options.serviceVersion,
          environment: this.options.environment,
          event: "candidate_projection.batch_failed",
          severity: "error",
          reasonCode: "database_unavailable",
          details: { message: error instanceof Error ? error.message : "unknown" },
        });
      }
      await sleep(this.options.pollMs, this.controller.signal);
    }
  }

  async stop(): Promise<void> {
    this.controller.abort();
    await this.runPromise;
  }
}
