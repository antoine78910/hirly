import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const REQUIRED_RIGHTS = [
  "commercial_use",
  "redisplay",
  "retention",
  "access_method",
] as const;

type RequiredRight = (typeof REQUIRED_RIGHTS)[number];

const EVIDENCE_KINDS = new Set([
  "approved_feed",
  "licence_text",
  "official_terms",
  "written_permission",
]);

const BLOCKER_CODES = new Set([
  "ACCESS_METHOD_NOT_APPROVED",
  "COMMERCIAL_USE_NOT_APPROVED",
  "REDISPLAY_NOT_APPROVED",
  "REPRESENTATIVE_SAMPLE_UNAVAILABLE",
  "RETENTION_NOT_APPROVED",
  "SOURCE_TERMS_UNVERIFIED",
]);

const ACCESS_METHODS = new Set([
  "open_data",
  "partner_feed",
  "public_api",
  "tenant_feed",
]);

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${path}_contains_unknown_fields:${unknown.join(",")}`);
  }
}

export interface SourcePolicyEvidenceItem {
  kind: "approved_feed" | "licence_text" | "official_terms" | "written_permission";
  reference: string;
  artifactPath: string;
  artifactSha256: string;
  supports: RequiredRight[];
}

export interface CapturedSourcePolicyEvidence {
  schemaVersion: "source-policy-result.v1";
  status: "EVIDENCE_CAPTURED";
  provider: string;
  sourceKey: string;
  resourceKey: string | null;
  tenantKey: string | null;
  capturedAt: string;
  productionEligible: false;
  permittedAccessMethod: string;
  reviewedBy: string;
  approvalReference: string;
  evidence: SourcePolicyEvidenceItem[];
}

export interface BlockedExternalSourcePolicy {
  schemaVersion: "source-policy-result.v1";
  status: "BLOCKED_EXTERNAL";
  provider: string;
  sourceKey: string;
  resourceKey: string | null;
  tenantKey: string | null;
  capturedAt: string;
  productionEligible: false;
  blockerCode:
    | "ACCESS_METHOD_NOT_APPROVED"
    | "COMMERCIAL_USE_NOT_APPROVED"
    | "REDISPLAY_NOT_APPROVED"
    | "REPRESENTATIVE_SAMPLE_UNAVAILABLE"
    | "RETENTION_NOT_APPROVED"
    | "SOURCE_TERMS_UNVERIFIED";
  reason: string;
  evidenceReferences: string[];
  missingEvidence: string[];
  unblockProcedure: string;
}

export type SourcePolicyResult =
  | CapturedSourcePolicyEvidence
  | BlockedExternalSourcePolicy;

export type PersistedSourcePolicyResult = SourcePolicyResult & {
  recordDigest: string;
};

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path}_must_be_an_object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path}_must_be_non_empty`);
  }
  return value.trim();
}

function timestamp(value: unknown, path: string): string {
  const parsed = text(value, path);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      parsed,
    )
    || !Number.isFinite(Date.parse(parsed))
  ) {
    throw new Error(`${path}_must_be_an_iso_timestamp`);
  }
  return parsed;
}

function falseLiteral(value: unknown, path: string): false {
  if (value !== false) throw new Error(`${path}_must_be_false`);
  return false;
}

function nullableText(value: unknown, path: string): string | null {
  return value === null ? null : text(value, path);
}

function stringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path}_must_be_a_non_empty_array`);
  }
  return value.map((item, index) => text(item, `${path}_${index}`));
}

function parseEvidence(value: unknown): SourcePolicyEvidenceItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("evidence_must_be_a_non_empty_array");
  }
  return value.map((item, index) => {
    const candidate = record(item, `evidence_${index}`);
    assertOnlyKeys(
      candidate,
      [
        "kind",
        "reference",
        "artifactPath",
        "artifactSha256",
        "supports",
      ],
      `evidence_${index}`,
    );
    const kind = text(candidate.kind, `evidence_${index}_kind`);
    if (!EVIDENCE_KINDS.has(kind)) {
      throw new Error(`evidence_${index}_kind_is_not_rights_evidence`);
    }
    const artifactSha256 = text(
      candidate.artifactSha256,
      `evidence_${index}_artifactSha256`,
    );
    if (!/^[0-9a-f]{64}$/.test(artifactSha256)) {
      throw new Error(`evidence_${index}_artifactSha256_must_be_sha256`);
    }
    const supports = stringList(
      candidate.supports,
      `evidence_${index}_supports`,
    );
    if (
      supports.some(
        (right) => !(REQUIRED_RIGHTS as readonly string[]).includes(right),
      )
    ) {
      throw new Error(`evidence_${index}_supports_unknown_right`);
    }
    return {
      kind: kind as SourcePolicyEvidenceItem["kind"],
      reference: text(candidate.reference, `evidence_${index}_reference`),
      artifactPath: text(
        candidate.artifactPath,
        `evidence_${index}_artifactPath`,
      ),
      artifactSha256,
      supports: [...new Set(supports)] as RequiredRight[],
    };
  });
}

export interface SourcePolicyScope {
  provider: string;
  sourceKey: string;
  resourceKey: string | null;
  tenantKey: string | null;
}

export function parseSourcePolicyResult(
  value: unknown,
  expectedScope?: SourcePolicyScope,
): SourcePolicyResult {
  const candidate = record(value, "source_policy_result");
  if (candidate.schemaVersion !== "source-policy-result.v1") {
    throw new Error("unsupported_source_policy_result_schema");
  }
  const common = {
    schemaVersion: "source-policy-result.v1" as const,
    provider: text(candidate.provider, "provider"),
    sourceKey: text(candidate.sourceKey, "sourceKey"),
    resourceKey: nullableText(candidate.resourceKey, "resourceKey"),
    tenantKey: nullableText(candidate.tenantKey, "tenantKey"),
    capturedAt: timestamp(candidate.capturedAt, "capturedAt"),
    productionEligible: falseLiteral(
      candidate.productionEligible,
      "productionEligible",
    ),
  };
  if (
    expectedScope
    && (
      common.provider !== expectedScope.provider
      || common.sourceKey !== expectedScope.sourceKey
      || common.resourceKey !== expectedScope.resourceKey
      || common.tenantKey !== expectedScope.tenantKey
    )
  ) {
    throw new Error("source_policy_scope_mismatch");
  }

  if (candidate.status === "BLOCKED_EXTERNAL") {
    assertOnlyKeys(
      candidate,
      [
        "schemaVersion",
        "status",
        "provider",
        "sourceKey",
        "resourceKey",
        "tenantKey",
        "capturedAt",
        "productionEligible",
        "blockerCode",
        "reason",
        "evidenceReferences",
        "missingEvidence",
        "unblockProcedure",
      ],
      "source_policy_result",
    );
    const blockerCode = text(candidate.blockerCode, "blockerCode");
    if (!BLOCKER_CODES.has(blockerCode)) {
      throw new Error("unsupported_blockerCode");
    }
    return {
      ...common,
      status: "BLOCKED_EXTERNAL",
      blockerCode:
        blockerCode as BlockedExternalSourcePolicy["blockerCode"],
      reason: text(candidate.reason, "reason"),
      evidenceReferences: stringList(
        candidate.evidenceReferences,
        "evidenceReferences",
      ),
      missingEvidence: stringList(candidate.missingEvidence, "missingEvidence"),
      unblockProcedure: text(candidate.unblockProcedure, "unblockProcedure"),
    };
  }

  if (candidate.status !== "EVIDENCE_CAPTURED") {
    throw new Error(
      "status_must_be_EVIDENCE_CAPTURED_or_BLOCKED_EXTERNAL",
    );
  }

  assertOnlyKeys(
    candidate,
    [
      "schemaVersion",
      "status",
      "provider",
      "sourceKey",
      "resourceKey",
      "tenantKey",
      "capturedAt",
      "productionEligible",
      "permittedAccessMethod",
      "reviewedBy",
      "approvalReference",
      "evidence",
    ],
    "source_policy_result",
  );
  const permittedAccessMethod = text(
    candidate.permittedAccessMethod,
    "permittedAccessMethod",
  );
  if (!ACCESS_METHODS.has(permittedAccessMethod)) {
    throw new Error("unsupported_permittedAccessMethod");
  }
  const evidence = parseEvidence(candidate.evidence);
  const supportedRights = new Set(
    evidence.flatMap((item) => item.supports),
  );
  const missingRights = REQUIRED_RIGHTS.filter(
    (right) => !supportedRights.has(right),
  );
  if (missingRights.length > 0) {
    throw new Error(
      `rights_evidence_incomplete:${missingRights.join(",")}`,
    );
  }

  return {
    ...common,
    status: "EVIDENCE_CAPTURED",
    permittedAccessMethod,
    reviewedBy: text(candidate.reviewedBy, "reviewedBy"),
    approvalReference: text(
      candidate.approvalReference,
      "approvalReference",
    ),
    evidence,
  };
}

export function finalizeSourcePolicyResult(
  value: unknown,
  expectedScope?: SourcePolicyScope,
): PersistedSourcePolicyResult {
  const result = parseSourcePolicyResult(value, expectedScope);
  const serialized = JSON.stringify(result);
  return {
    ...result,
    recordDigest: createHash("sha256").update(serialized).digest("hex"),
  };
}

export function verifyPersistedSourcePolicyResult(
  value: unknown,
  expectedScope?: SourcePolicyScope,
): PersistedSourcePolicyResult {
  const candidate = record(value, "persisted_source_policy_result");
  const recordDigest = text(candidate.recordDigest, "recordDigest");
  const unpersisted = { ...candidate };
  delete unpersisted.recordDigest;
  const finalized = finalizeSourcePolicyResult(unpersisted, expectedScope);
  if (recordDigest !== finalized.recordDigest) {
    throw new Error("source_policy_record_digest_mismatch");
  }
  return finalized;
}

export async function persistSourcePolicyResult(
  outputPath: string,
  value: unknown,
  expectedScope?: SourcePolicyScope,
): Promise<PersistedSourcePolicyResult> {
  const result = finalizeSourcePolicyResult(value, expectedScope);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, {
    flag: "wx",
  });
  return result;
}
