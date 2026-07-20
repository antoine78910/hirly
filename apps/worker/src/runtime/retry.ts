export class PermanentTaskError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PermanentTaskError";
    this.code = code;
  }
}

export function retryDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const base = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.8 + random() * 0.4));
}

export function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "unknown task failure";
  const redacted = redact(error.message);
  return String(redacted).slice(0, 512);
}
import { redact } from "@hirly/observability";
