import { z } from "zod";

const sensitiveKey =
  /(authorization|cookie|credential|database.?url|evidence.?body|password|payload|raw|secret|token)/i;
const piiKey = /(^|_)(email|phone|first.?name|last.?name|full.?name)($|_)/i;
const credentialUrl = /\b(?:postgres(?:ql)?|https?):\/\/[^/\s:@]+:[^@\s]+@/gi;
const bearer = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;

export const eventSchema = z
  .object({
    service: z.string().min(1),
    version: z.string().min(1),
    environment: z.string().min(1),
    event: z.string().min(1),
    severity: z.enum(["debug", "info", "warn", "error"]),
    runId: z.uuid().optional(),
    taskId: z.uuid().optional(),
    taskType: z.string().optional(),
    provider: z.string().optional(),
    triggerSource: z.string().optional(),
    attempt: z.number().int().positive().optional(),
    maxAttempts: z.number().int().positive().optional(),
    durationsMs: z
      .object({
        queueWait: z.number().nonnegative(),
        fetch: z.number().nonnegative(),
        normalization: z.number().nonnegative(),
        validation: z.number().nonnegative(),
        database: z.number().nonnegative(),
        total: z.number().nonnegative(),
      })
      .strict()
      .optional(),
    counts: z
      .object({
        fetched: z.number().int().nonnegative(),
        accepted: z.number().int().nonnegative(),
        rejected: z.number().int().nonnegative(),
        deduplicated: z.number().int().nonnegative(),
        upserted: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    outcome: z.string().optional(),
    reasonCode: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type StructuredEvent = z.infer<typeof eventSchema>;

function redactString(value: string): string {
  return value.replace(credentialUrl, (match) => {
    const schemeEnd = match.indexOf("://") + 3;
    return `${match.slice(0, schemeEnd)}[REDACTED]@`;
  }).replace(bearer, "Bearer [REDACTED]");
}

export function redact(value: unknown, key = ""): unknown {
  if (sensitiveKey.test(key) || piiKey.test(key)) {
    return "[REDACTED]";
  }
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((entry) => redact(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entry]) => [
        entryKey,
        redact(entry, entryKey),
      ]),
    );
  }
  return value;
}

export function serializeEvent(event: StructuredEvent): string {
  const parsed = eventSchema.parse(event);
  return JSON.stringify(redact(parsed));
}

export interface Logger {
  emit(event: StructuredEvent): void;
}

export function createJsonLogger(
  write: (line: string) => void = (line) => console.log(line),
): Logger {
  return {
    emit(event) {
      write(serializeEvent(event));
    },
  };
}
