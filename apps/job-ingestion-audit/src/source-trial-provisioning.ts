import { createHash } from "node:crypto";
import {
  verifyPersistedSourcePolicyResult,
  type CapturedSourcePolicyEvidence,
} from "./source-policy-result";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const TRIAL_KEY = /^[a-z0-9]+(?:[a-z0-9._:-]*[a-z0-9])?$/;
const PROVIDERS = new Set(["data_gouv", "greenhouse", "lever"]);
const ENVIRONMENTS = new Set(["development", "test", "staging"]);
const ACCESS_METHODS = new Set(["open_data", "partner_feed", "public_api", "tenant_feed"]);
const REQUIRED_RIGHTS = ["commercial_use", "redisplay", "retention", "access_method"];

export interface SourceTrialProvisioningInput {
  schemaVersion: "hirly.source-trial-provisioning.v1";
  source: {
    id: string;
    provider: string;
    sourceKey: string;
    tenantKey: string;
    companyName: string | null;
    countryCodes: string[];
    baseUrl: string;
    accessType: string;
  };
  policyEvidence: {
    id: string;
    evidenceKey: string;
    selectedEvidenceIndex: number;
  };
  policy: {
    id: string;
    environment: string;
    startsAt: string;
    expiresAt: string;
    maxTotalRuns: number;
    approvedBy: string;
    approvalReference: string;
    tenantSelectionEvidence: {
      reference: string;
      sha256: string;
    };
  };
  manifest: {
    trialKey: string;
    requestedAt: string;
    expiresAt: string;
    budget: {
      maxPages: number;
      maxCandidates: number;
      maxBytes: number;
    };
  };
}

export interface SourceTrialProvisioningOutput {
  manifest: Record<string, unknown>;
  sql: string;
  digest: string;
}

const fail = (message: string): never => {
  throw new Error(`SOURCE_TRIAL_PROVISIONING_REFUSED: ${message}`);
};

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${path} fields must be exactly ${expected.join(",")}`);
  }
}

function text(value: unknown, path: string, max = 2_048): string {
  const parsed = typeof value === "string" ? value.trim() : "";
  if (parsed === "" || parsed.length > max) {
    fail(`${path} must be non-empty and at most ${max} characters`);
  }
  return parsed;
}

function uuid(value: unknown, path: string): string {
  const parsed = text(value, path, 36).toLowerCase();
  if (!UUID.test(parsed)) fail(`${path} must be a UUID`);
  return parsed;
}

function timestamp(value: unknown, path: string): string {
  const parsed = text(value, path, 64);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(parsed) ||
    !Number.isFinite(Date.parse(parsed))
  ) {
    fail(`${path} must be an ISO timestamp with an explicit timezone`);
  }
  return new Date(parsed).toISOString();
}

function positiveInteger(value: unknown, path: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    fail(`${path} must be an integer between 1 and ${maximum}`);
  }
  return value as number;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlNullable(value: string | null): string {
  return value === null ? "NULL" : sqlLiteral(value);
}

function sqlArray(values: readonly string[]): string {
  return `ARRAY[${values.map(sqlLiteral).join(", ")}]::text[]`;
}

function absoluteUrl(value: string, path: string): URL {
  try {
    return new URL(value);
  } catch {
    return fail(`${path} must be an absolute URL`);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseInput(value: unknown): SourceTrialProvisioningInput {
  const root = object(value, "input");
  exactKeys(root, ["schemaVersion", "source", "policyEvidence", "policy", "manifest"], "input");
  if (root.schemaVersion !== "hirly.source-trial-provisioning.v1") {
    fail("unsupported schemaVersion");
  }

  const sourceValue = object(root.source, "source");
  exactKeys(
    sourceValue,
    [
      "id",
      "provider",
      "sourceKey",
      "tenantKey",
      "companyName",
      "countryCodes",
      "baseUrl",
      "accessType",
    ],
    "source",
  );
  const provider = text(sourceValue.provider, "source.provider", 64).toLowerCase();
  if (!PROVIDERS.has(provider)) fail(`source.provider ${provider} has no trial runner`);
  const accessType = text(sourceValue.accessType, "source.accessType", 64);
  if (!ACCESS_METHODS.has(accessType)) fail("source.accessType is unsupported");
  if (
    (provider === "data_gouv" && accessType !== "open_data") ||
    (provider !== "data_gouv" && accessType !== "tenant_feed")
  ) {
    fail("source provider/accessType binding is invalid");
  }
  const rawCountryCodes = sourceValue.countryCodes;
  if (!Array.isArray(rawCountryCodes) || rawCountryCodes.length === 0) {
    fail("source.countryCodes must be a non-empty array");
  }
  const countryCodes = (rawCountryCodes as unknown[]).map((entry, index) => {
    const code = text(entry, `source.countryCodes[${index}]`, 2);
    if (!/^[A-Z]{2}$/.test(code))
      fail(`source.countryCodes[${index}] must be ISO alpha-2 uppercase`);
    return code;
  });
  if (new Set(countryCodes).size !== countryCodes.length) {
    fail("source.countryCodes must be unique");
  }
  const baseUrl = text(sourceValue.baseUrl, "source.baseUrl");
  const parsedBaseUrl = absoluteUrl(baseUrl, "source.baseUrl");
  if (
    parsedBaseUrl.protocol !== "https:" ||
    parsedBaseUrl.username ||
    parsedBaseUrl.password ||
    parsedBaseUrl.hash
  ) {
    fail("source.baseUrl must be credential-free HTTPS without a fragment");
  }
  const companyName =
    sourceValue.companyName === null
      ? null
      : text(sourceValue.companyName, "source.companyName", 512);

  const evidenceValue = object(root.policyEvidence, "policyEvidence");
  exactKeys(evidenceValue, ["id", "evidenceKey", "selectedEvidenceIndex"], "policyEvidence");
  const selectedEvidenceIndex = evidenceValue.selectedEvidenceIndex;
  if (!Number.isSafeInteger(selectedEvidenceIndex) || (selectedEvidenceIndex as number) < 0) {
    fail("policyEvidence.selectedEvidenceIndex must be a non-negative integer");
  }

  const policyValue = object(root.policy, "policy");
  exactKeys(
    policyValue,
    [
      "id",
      "environment",
      "startsAt",
      "expiresAt",
      "maxTotalRuns",
      "approvedBy",
      "approvalReference",
      "tenantSelectionEvidence",
    ],
    "policy",
  );
  const environment = text(policyValue.environment, "policy.environment", 32);
  if (!ENVIRONMENTS.has(environment)) fail("policy.environment must be non-production");
  const startsAt = timestamp(policyValue.startsAt, "policy.startsAt");
  const policyExpiresAt = timestamp(policyValue.expiresAt, "policy.expiresAt");
  if (Date.parse(policyExpiresAt) <= Date.parse(startsAt)) {
    fail("policy.expiresAt must be after policy.startsAt");
  }
  const selectionValue = object(
    policyValue.tenantSelectionEvidence,
    "policy.tenantSelectionEvidence",
  );
  exactKeys(selectionValue, ["reference", "sha256"], "policy.tenantSelectionEvidence");
  const selectionSha256 = text(selectionValue.sha256, "policy.tenantSelectionEvidence.sha256", 64);
  if (!SHA256.test(selectionSha256)) {
    fail("policy.tenantSelectionEvidence.sha256 must be lowercase SHA-256");
  }

  const manifestValue = object(root.manifest, "manifest");
  exactKeys(manifestValue, ["trialKey", "requestedAt", "expiresAt", "budget"], "manifest");
  const trialKey = text(manifestValue.trialKey, "manifest.trialKey", 256);
  if (!TRIAL_KEY.test(trialKey)) fail("manifest.trialKey has invalid characters");
  const requestedAt = timestamp(manifestValue.requestedAt, "manifest.requestedAt");
  const manifestExpiresAt = timestamp(manifestValue.expiresAt, "manifest.expiresAt");
  if (
    Date.parse(requestedAt) < Date.parse(startsAt) ||
    Date.parse(manifestExpiresAt) > Date.parse(policyExpiresAt) ||
    Date.parse(manifestExpiresAt) <= Date.parse(requestedAt)
  ) {
    fail("manifest window must be contained inside the policy window");
  }
  const budgetValue = object(manifestValue.budget, "manifest.budget");
  exactKeys(budgetValue, ["maxPages", "maxCandidates", "maxBytes"], "manifest.budget");

  return {
    schemaVersion: "hirly.source-trial-provisioning.v1",
    source: {
      id: uuid(sourceValue.id, "source.id"),
      provider,
      sourceKey: text(sourceValue.sourceKey, "source.sourceKey", 512),
      tenantKey: text(sourceValue.tenantKey, "source.tenantKey", 512),
      companyName,
      countryCodes,
      baseUrl: parsedBaseUrl.href,
      accessType,
    },
    policyEvidence: {
      id: uuid(evidenceValue.id, "policyEvidence.id"),
      evidenceKey: text(evidenceValue.evidenceKey, "policyEvidence.evidenceKey", 512),
      selectedEvidenceIndex: selectedEvidenceIndex as number,
    },
    policy: {
      id: uuid(policyValue.id, "policy.id"),
      environment,
      startsAt,
      expiresAt: policyExpiresAt,
      maxTotalRuns: positiveInteger(policyValue.maxTotalRuns, "policy.maxTotalRuns", 1_000),
      approvedBy: text(policyValue.approvedBy, "policy.approvedBy", 512),
      approvalReference: text(policyValue.approvalReference, "policy.approvalReference", 2_048),
      tenantSelectionEvidence: {
        reference: text(
          selectionValue.reference,
          "policy.tenantSelectionEvidence.reference",
          2_048,
        ),
        sha256: selectionSha256,
      },
    },
    manifest: {
      trialKey,
      requestedAt,
      expiresAt: manifestExpiresAt,
      budget: {
        maxPages: positiveInteger(budgetValue.maxPages, "manifest.budget.maxPages", 10_000),
        maxCandidates: positiveInteger(
          budgetValue.maxCandidates,
          "manifest.budget.maxCandidates",
          1_000_000,
        ),
        maxBytes: positiveInteger(budgetValue.maxBytes, "manifest.budget.maxBytes", 1_073_741_824),
      },
    },
  };
}

export function provisionSourceTrial(
  inputValue: unknown,
  policyEvidenceValue: unknown,
): SourceTrialProvisioningOutput {
  const input = parseInput(inputValue);
  const reviewed = verifyPersistedSourcePolicyResult(policyEvidenceValue, {
    provider: input.source.provider,
    sourceKey: input.source.sourceKey,
    resourceKey: input.source.provider === "data_gouv" ? input.source.tenantKey : null,
    tenantKey: input.source.tenantKey,
  });
  if (reviewed.status !== "EVIDENCE_CAPTURED") {
    fail(`policy evidence is ${reviewed.status}`);
  }
  const approved = reviewed as CapturedSourcePolicyEvidence & {
    recordDigest: string;
  };
  if (
    approved.permittedAccessMethod !== input.source.accessType ||
    approved.reviewedBy !== input.policy.approvedBy ||
    approved.approvalReference !== input.policy.approvalReference
  ) {
    fail("reviewed policy does not match source access or trial approver");
  }
  const selectedEvidence = approved.evidence[input.policyEvidence.selectedEvidenceIndex];
  if (!selectedEvidence) fail("selected rights evidence does not exist");
  if (!["licence_text", "written_permission"].includes(selectedEvidence.kind)) {
    fail("selected rights evidence cannot authorize a source trial");
  }
  if (
    REQUIRED_RIGHTS.some(
      (right) => !(selectedEvidence.supports as readonly string[]).includes(right),
    )
  ) {
    fail("selected rights evidence must individually cover every required right");
  }

  const manifest = {
    schemaVersion: "hirly.source-trial-manifest.v1",
    trialKey: input.manifest.trialKey,
    sourceId: input.source.id,
    provider: input.source.provider,
    tenantKey: input.source.tenantKey,
    environment: input.policy.environment,
    countryCodes: input.source.countryCodes,
    policyEvidenceId: input.policyEvidence.id,
    tenantSelectionEvidence: input.policy.tenantSelectionEvidence,
    requestedAt: input.manifest.requestedAt,
    expiresAt: input.manifest.expiresAt,
    budget: input.manifest.budget,
  };
  const claimScope = {
    trialEligible: true,
    provider: input.source.provider,
    sourceKey: input.source.sourceKey,
    tenantKey: input.source.tenantKey,
    permittedAccessMethod: input.source.accessType,
    rights: REQUIRED_RIGHTS,
    environments: [input.policy.environment],
    productionEligible: false,
  };

  const sql = `-- Generated by source-trial:provision. REVIEW BEFORE EXECUTION.
-- TS_NEW evidence-only trial policy. This never activates a source, provider,
-- schedule, canonical writer, canonical job write, application, or queue.
BEGIN;

INSERT INTO public.career_sources (
  id, provider, source_key, tenant_key, company_name, country_codes,
  base_url, access_type, discovery_state, enabled,
  transport_enabled, incremental_enabled, backfill_enabled
) VALUES (
  ${sqlLiteral(input.source.id)}::uuid,
  ${sqlLiteral(input.source.provider)},
  ${sqlLiteral(input.source.sourceKey)},
  ${sqlLiteral(input.source.tenantKey)},
  ${sqlNullable(input.source.companyName)},
  ${sqlArray(input.source.countryCodes)},
  ${sqlLiteral(input.source.baseUrl)},
  ${sqlLiteral(input.source.accessType)},
  'validated',
  false, false, false, false
);

INSERT INTO public.source_policy_evidence (
  id, source_key, evidence_key, evidence_type, evidence_reference,
  artifact_path, artifact_sha256, captured_at, qualification_status,
  production_eligible, claim_scope
) VALUES (
  ${sqlLiteral(input.policyEvidence.id)}::uuid,
  ${sqlLiteral(input.source.sourceKey)},
  ${sqlLiteral(input.policyEvidence.evidenceKey)},
  ${sqlLiteral(selectedEvidence.kind)},
  ${sqlLiteral(selectedEvidence.reference)},
  ${sqlLiteral(selectedEvidence.artifactPath)},
  ${sqlLiteral(selectedEvidence.artifactSha256)},
  ${sqlLiteral(approved.capturedAt)}::timestamptz,
  'trial_approved',
  false,
  ${sqlLiteral(JSON.stringify(claimScope))}::jsonb
);

INSERT INTO public.source_trial_policies (
  id, source_id, provider, tenant_key, policy_evidence_id,
  permitted_access_method, environment, starts_at, expires_at,
  max_total_runs, max_pages_per_run, max_candidates_per_run,
  max_bytes_per_run, trial_enabled, approved_by, approval_reference,
  tenant_selection_evidence_reference, tenant_selection_evidence_sha256
) VALUES (
  ${sqlLiteral(input.policy.id)}::uuid,
  ${sqlLiteral(input.source.id)}::uuid,
  ${sqlLiteral(input.source.provider)},
  ${sqlLiteral(input.source.tenantKey)},
  ${sqlLiteral(input.policyEvidence.id)}::uuid,
  ${sqlLiteral(input.source.accessType)},
  ${sqlLiteral(input.policy.environment)},
  ${sqlLiteral(input.policy.startsAt)}::timestamptz,
  ${sqlLiteral(input.policy.expiresAt)}::timestamptz,
  ${input.policy.maxTotalRuns},
  ${input.manifest.budget.maxPages},
  ${input.manifest.budget.maxCandidates},
  ${input.manifest.budget.maxBytes},
  true,
  ${sqlLiteral(input.policy.approvedBy)},
  ${sqlLiteral(input.policy.approvalReference)},
  ${sqlLiteral(input.policy.tenantSelectionEvidence.reference)},
  ${sqlLiteral(input.policy.tenantSelectionEvidence.sha256)}
);

DO $source_trial_provisioning_guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.career_sources AS source
    JOIN public.source_trial_policies AS policy ON policy.source_id = source.id
    JOIN public.source_policy_evidence AS evidence
      ON evidence.id = policy.policy_evidence_id
    WHERE source.id = ${sqlLiteral(input.source.id)}::uuid
      AND NOT source.enabled
      AND NOT source.transport_enabled
      AND NOT source.incremental_enabled
      AND NOT source.backfill_enabled
      AND evidence.qualification_status = 'trial_approved'
      AND NOT evidence.production_eligible
      AND policy.trial_enabled
      AND policy.environment <> 'production'
  ) THEN
    RAISE EXCEPTION 'source trial provisioning invariant failed';
  END IF;
END
$source_trial_provisioning_guard$;

COMMIT;
`;
  return {
    manifest,
    sql,
    digest: createHash("sha256").update(stableJson({ manifest, sql })).digest("hex"),
  };
}
