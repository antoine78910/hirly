import { z } from "zod";
export const opaqueId = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[a-z0-9][a-z0-9_-]{2,127}$`));
export const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const isoTimestamp = z.string().datetime({ offset: true });
export const origin = z
  .string()
  .url()
  .refine((value) => {
    try {
      return new URL(value).origin === value && new URL(value).pathname === "/";
    } catch {
      return false;
    }
  }, "origin only");
export const safeRef = z.string().regex(/^[a-z][a-z0-9-]{1,40}:[a-zA-Z0-9._:/-]{3,240}$/);
export const sensitivity = z.enum(["public", "internal", "confidential", "restricted"]);
export const safeReasonCode = z.enum([
  "UNSUPPORTED_ATS",
  "INVALID_JOB_URL",
  "JOB_EXTRACTION_FAILED",
  "CANDIDATE_EVIDENCE_NOT_FOUND",
  "UNSUPPORTED_APPLICATION_CLAIM",
  "CONFLICTING_CANDIDATE_EVIDENCE",
  "MISSING_CANDIDATE_INPUT",
  "STALE_SUBMISSION_PLAN",
  "TARGET_ORIGIN_MISMATCH",
  "ADAPTER_CAPABILITY_MISMATCH",
  "APPROVAL_REQUIRED",
  "APPROVAL_REPLAYED",
  "IDEMPOTENCY_CONFLICT",
  "SUBMISSION_NOT_CONFIRMED",
  "PROVIDER_RATE_LIMITED",
  "INTERNAL_ERROR",
]);
export const version = z.string().regex(/^\d+\.\d+\.\d+$/);
