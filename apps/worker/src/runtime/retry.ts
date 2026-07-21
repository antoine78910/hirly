import { redact } from "@hirly/observability";

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
  let message: unknown;
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else if (error && typeof error === "object") {
    try {
      message = JSON.stringify(redact(error));
    } catch {
      message = "unknown task failure";
    }
  } else {
    message = "unknown task failure";
  }
  return String(redact(message)).slice(0, 512);
}
