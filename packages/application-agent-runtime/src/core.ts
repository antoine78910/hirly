import { createHash } from "node:crypto";
import type {
  Clock,
  Hasher,
  IdGenerator,
  IdempotencyStore,
  Redactor,
  SafeLogger,
  SafeLogFields,
  ApprovalNonceStore,
} from "./ports";

/** Matches runtime-core's approval serializer without taking runtime-core as a production dependency. */
export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Approval input is not JSON.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  throw new TypeError("Approval input is not JSON.");
};
export const sha256 = (value: unknown): string =>
  `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
export const systemClock: Clock = { now: () => new Date() };
export const sha256Hasher: Hasher = { digest: sha256 };
export const incrementalIds = (): IdGenerator => {
  let i = 0;
  return { next: (prefix) => `${prefix}_fixture-${++i}` };
};
export const memoryNonceStore = (): ApprovalNonceStore => {
  const used = new Set<string>();
  return {
    async consume(nonce) {
      if (used.has(nonce)) return false;
      used.add(nonce);
      return true;
    },
  };
};
export const memoryIdempotencyStore = (): IdempotencyStore => {
  const used = new Set<string>();
  return {
    async claim(key) {
      if (used.has(key)) return "duplicate";
      used.add(key);
      return "claimed";
    },
  };
};
/** This foundation deliberately supports only deterministic fixture composition. */
export const assertFixtureOnlyMode = (mode: "fixture" | "production") => {
  if (mode !== "fixture")
    throw new Error(
      "PRODUCTION_COMPOSITION_UNAVAILABLE: durable stores and a separately approved production adapter are required",
    );
};
const forbidden = /cv|email|name|address|cover|salary|legal|payload|statement|prompt/i;
export const safeRedactor: Redactor = {
  redact(value) {
    if (Array.isArray(value)) return value.map((v) => safeRedactor.redact(v));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [
          k,
          forbidden.test(k) ? "[REDACTED]" : safeRedactor.redact(v),
        ]),
      );
    return value;
  },
};
const safeLogFieldNames = new Set([
  "subjectRef",
  "entityRef",
  "planDigest",
  "reasonCodes",
  "occurredAt",
]);
const validateSafeLogFields = (fields: SafeLogFields) => {
  for (const [key, value] of Object.entries(fields)) {
    if (
      !safeLogFieldNames.has(key) ||
      forbidden.test(key) ||
      (typeof value === "string" && /\s/.test(value))
    )
      throw new Error("UNSAFE_APPLICATION_AGENT_LOG_RECORD");
  }
  return fields;
};
export type SafeLogRecord = {
  level: "info" | "error";
  event: "application_agent_operation" | "application_agent_failure";
  fields: SafeLogFields;
};
export const memorySafeLogger = (
  records: SafeLogRecord[] = [],
): SafeLogger & { records: SafeLogRecord[] } => ({
  records,
  info(event, fields) {
    records.push({ level: "info", event, fields: validateSafeLogFields(fields) });
  },
  error(event, fields) {
    records.push({ level: "error", event, fields: validateSafeLogFields(fields) });
  },
});
