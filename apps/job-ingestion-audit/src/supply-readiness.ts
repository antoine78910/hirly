import { createHash } from "node:crypto";

export type SupplyFulfillmentRoute = "auto" | "assisted" | "manual" | "blocked";

export interface SupplySegment {
  countryCode: string;
  cohortId: string;
  roleFamilyId: string;
  radiusKm?: number;
}

export interface SupplyThreshold {
  thresholdId: string;
  segment: SupplySegment;
  minimumFreshVisibleCanonicalGroups: number;
  approvedByProduct: string;
  approvedAt: string;
}

export interface SupplyException {
  exceptionId: string;
  name: string;
  segment: SupplySegment;
  minimumFreshVisibleCanonicalGroups: number;
  approvedByProduct: string;
  approvedAt: string;
  expiresAt: string;
  reason: string;
}

export interface SupplyObservation {
  canonicalGroupId: string;
  countryCode: string;
  cohortIds: string[];
  roleFamilyIds: string[];
  fresh: boolean;
  visible: boolean;
  fulfillmentRoute: SupplyFulfillmentRoute;
}

export interface SupplyReadinessInput {
  status: "COMPLETE" | "BLOCKED_EXTERNAL";
  blockerReason?: string;
  sample: boolean;
  environment: "production" | "production_like" | "fixture";
  evidenceId: string;
  sourceDigest: string;
  cohortDigest: string;
  canonicalIdentityContract: "canonical_group_id_only";
  eligibilityContract: "active_valid_fresh_visible_canonical_groups";
  generatedAt: string;
  freshnessCutoff: string;
  segment: SupplySegment;
  threshold: SupplyThreshold;
  observations?: SupplyObservation[];
}

export interface SupplyReadinessScorecard {
  schemaVersion: "hirly.supply-readiness.v1";
  status: "READY" | "EXCEPTION" | "BLOCKED";
  scoreable: boolean;
  supplyGateSatisfied: boolean;
  environment: SupplyReadinessInput["environment"];
  evidenceId: string;
  evidenceBinding: {
    sourceDigest: string;
    cohortDigest: string;
    canonicalIdentityContract: "canonical_group_id_only";
    eligibilityContract: "active_valid_fresh_visible_canonical_groups";
  };
  generatedAt: string;
  evaluatedAt: string;
  freshnessCutoff: string;
  segment: SupplySegment;
  threshold: SupplyThreshold;
  appliedMinimumFreshVisibleCanonicalGroups: number;
  counts: {
    segmentCanonicalGroups: number | null;
    freshCanonicalGroups: number | null;
    visibleCanonicalGroups: number | null;
    freshVisibleCanonicalGroups: number | null;
    freshVisibleByFulfillmentRoute: Record<SupplyFulfillmentRoute, number> | null;
  };
  appliedException: Omit<SupplyException, "reason"> | null;
  failedGates: string[];
  blockerReason: string | null;
  safeguards: {
    readOnly: true;
    aggregateOnly: true;
    canonicalWrites: false;
    featureFlagChanges: false;
    exposureAuthorized: false;
    servingBranchSelection: false;
  };
  digest: string;
}

export const PARIS_FULLSTACK_SEGMENT: Readonly<SupplySegment> = Object.freeze({
  countryCode: "FR",
  cohortId: "paris-52km",
  roleFamilyId: "fullstack-engineering",
  radiusKm: 52,
});

export const PARIS_FULLSTACK_MIN_FRESH_VISIBLE_GROUPS = 12;

const fulfillmentRoutes: readonly SupplyFulfillmentRoute[] = [
  "auto",
  "assisted",
  "manual",
  "blocked",
];

const isoTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i;
const sha256Pattern = /^[a-f0-9]{64}$/;

const fail = (message: string): never => {
  throw new Error(`SUPPLY_READINESS_REFUSED: ${message}`);
};

function nonEmpty(value: string, path: string): string {
  const normalized = value.trim();
  if (!normalized) fail(`${path} must be a non-empty string`);
  return normalized;
}

function timestamp(value: string, path: string): string {
  if (!isoTimestampPattern.test(value) || !Number.isFinite(Date.parse(value))) {
    fail(`${path} must be an ISO timestamp with an explicit timezone`);
  }
  return new Date(value).toISOString();
}

function positiveInteger(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(`${path} must be a positive safe integer`);
  }
  return value;
}

function normalizeSegment(segment: SupplySegment, path: string): SupplySegment {
  const countryCode = nonEmpty(segment.countryCode, `${path}.countryCode`).toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) fail(`${path}.countryCode must be ISO alpha-2`);
  if (
    segment.radiusKm !== undefined &&
    (!Number.isFinite(segment.radiusKm) || segment.radiusKm <= 0)
  ) {
    fail(`${path}.radiusKm must be a positive finite number`);
  }
  return {
    countryCode,
    cohortId: nonEmpty(segment.cohortId, `${path}.cohortId`).toLowerCase(),
    roleFamilyId: nonEmpty(segment.roleFamilyId, `${path}.roleFamilyId`).toLowerCase(),
    ...(segment.radiusKm === undefined ? {} : { radiusKm: segment.radiusKm }),
  };
}

function sameSegment(left: SupplySegment, right: SupplySegment): boolean {
  return (
    left.countryCode === right.countryCode &&
    left.cohortId === right.cohortId &&
    left.roleFamilyId === right.roleFamilyId &&
    left.radiusKm === right.radiusKm
  );
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function normalizeThreshold(
  threshold: SupplyThreshold,
  segment: SupplySegment,
  evaluatedAt: string,
): SupplyThreshold {
  const normalized = {
    thresholdId: nonEmpty(threshold.thresholdId, "threshold.thresholdId"),
    segment: normalizeSegment(threshold.segment, "threshold.segment"),
    minimumFreshVisibleCanonicalGroups: positiveInteger(
      threshold.minimumFreshVisibleCanonicalGroups,
      "threshold.minimumFreshVisibleCanonicalGroups",
    ),
    approvedByProduct: nonEmpty(threshold.approvedByProduct, "threshold.approvedByProduct"),
    approvedAt: timestamp(threshold.approvedAt, "threshold.approvedAt"),
  };
  if (!sameSegment(normalized.segment, segment)) {
    fail("threshold segment does not match scorecard segment");
  }
  if (Date.parse(normalized.approvedAt) > Date.parse(evaluatedAt)) {
    fail("threshold approval is later than evaluation time");
  }
  return normalized;
}

function normalizeException(
  exception: SupplyException,
  segment: SupplySegment,
  threshold: SupplyThreshold,
  evaluatedAt: string,
): SupplyException & { active: boolean } {
  const normalized = {
    exceptionId: nonEmpty(exception.exceptionId, "exception.exceptionId"),
    name: nonEmpty(exception.name, "exception.name"),
    segment: normalizeSegment(exception.segment, "exception.segment"),
    minimumFreshVisibleCanonicalGroups: positiveInteger(
      exception.minimumFreshVisibleCanonicalGroups,
      "exception.minimumFreshVisibleCanonicalGroups",
    ),
    approvedByProduct: nonEmpty(exception.approvedByProduct, "exception.approvedByProduct"),
    approvedAt: timestamp(exception.approvedAt, "exception.approvedAt"),
    expiresAt: timestamp(exception.expiresAt, "exception.expiresAt"),
    reason: nonEmpty(exception.reason, "exception.reason"),
  };
  if (!sameSegment(normalized.segment, segment)) {
    fail("exception segment does not match scorecard segment");
  }
  if (
    normalized.minimumFreshVisibleCanonicalGroups >= threshold.minimumFreshVisibleCanonicalGroups
  ) {
    fail("exception minimum must be lower than the approved threshold");
  }
  if (Date.parse(normalized.expiresAt) <= Date.parse(normalized.approvedAt)) {
    fail("exception expiry must be later than its approval");
  }
  if (Date.parse(normalized.approvedAt) > Date.parse(evaluatedAt)) {
    fail("exception approval is later than evaluation time");
  }
  return {
    ...normalized,
    active: Date.parse(normalized.expiresAt) > Date.parse(evaluatedAt),
  };
}

function safeguards(): SupplyReadinessScorecard["safeguards"] {
  return {
    readOnly: true,
    aggregateOnly: true,
    canonicalWrites: false,
    featureFlagChanges: false,
    exposureAuthorized: false,
    servingBranchSelection: false,
  };
}

export function buildSupplyReadinessScorecard(
  input: SupplyReadinessInput,
  options: { evaluatedAt?: string; exception?: SupplyException } = {},
): SupplyReadinessScorecard {
  const generatedAt = timestamp(input.generatedAt, "generatedAt");
  const evaluatedAt = timestamp(options.evaluatedAt ?? generatedAt, "evaluatedAt");
  const freshnessCutoff = timestamp(input.freshnessCutoff, "freshnessCutoff");
  if (Date.parse(generatedAt) < Date.parse(freshnessCutoff)) {
    fail("generatedAt must not precede freshnessCutoff");
  }
  if (Date.parse(evaluatedAt) < Date.parse(generatedAt)) {
    fail("evaluatedAt must not precede generatedAt");
  }
  const segment = normalizeSegment(input.segment, "segment");
  const threshold = normalizeThreshold(input.threshold, segment, evaluatedAt);
  const evidenceId = nonEmpty(input.evidenceId, "evidenceId");
  if (!sha256Pattern.test(input.sourceDigest)) {
    fail("sourceDigest must be a SHA-256 value");
  }
  if (!sha256Pattern.test(input.cohortDigest)) {
    fail("cohortDigest must be a SHA-256 value");
  }
  if (input.canonicalIdentityContract !== "canonical_group_id_only") {
    fail("canonicalIdentityContract must exclude provider fallback identities");
  }
  if (input.eligibilityContract !== "active_valid_fresh_visible_canonical_groups") {
    fail("eligibilityContract must bind active, valid, fresh, visible groups");
  }
  const evidenceBinding = {
    sourceDigest: input.sourceDigest,
    cohortDigest: input.cohortDigest,
    canonicalIdentityContract: input.canonicalIdentityContract,
    eligibilityContract: input.eligibilityContract,
  };

  if (input.status === "BLOCKED_EXTERNAL") {
    const blockerReason = nonEmpty(input.blockerReason ?? "", "blockerReason");
    const unsigned: Omit<SupplyReadinessScorecard, "digest"> = {
      schemaVersion: "hirly.supply-readiness.v1",
      status: "BLOCKED",
      scoreable: false,
      supplyGateSatisfied: false,
      environment: input.environment,
      evidenceId,
      evidenceBinding,
      generatedAt,
      evaluatedAt,
      freshnessCutoff,
      segment,
      threshold,
      appliedMinimumFreshVisibleCanonicalGroups: threshold.minimumFreshVisibleCanonicalGroups,
      counts: {
        segmentCanonicalGroups: null,
        freshCanonicalGroups: null,
        visibleCanonicalGroups: null,
        freshVisibleCanonicalGroups: null,
        freshVisibleByFulfillmentRoute: null,
      },
      appliedException: null,
      failedGates: ["production_like_supply_evidence_unavailable"],
      blockerReason,
      safeguards: safeguards(),
    };
    return { ...unsigned, digest: digest(unsigned) };
  }

  if (input.sample !== false) fail("sample evidence is not scoreable");
  if (input.environment === "fixture") {
    fail("fixture evidence cannot establish supply readiness");
  }
  const observations = input.observations ?? fail("observations must be an array");

  const groupIds = new Set<string>();
  const matching: Array<SupplyObservation & { countryCode: string }> = [];
  observations.forEach((observation, index) => {
    const canonicalGroupId = nonEmpty(
      observation.canonicalGroupId,
      `observations[${index}].canonicalGroupId`,
    );
    if (groupIds.has(canonicalGroupId)) {
      fail(`duplicate canonical group ${canonicalGroupId}`);
    }
    groupIds.add(canonicalGroupId);
    const countryCode = nonEmpty(
      observation.countryCode,
      `observations[${index}].countryCode`,
    ).toUpperCase();
    if (!fulfillmentRoutes.includes(observation.fulfillmentRoute)) {
      fail(`observations[${index}].fulfillmentRoute is invalid`);
    }
    if (typeof observation.fresh !== "boolean") {
      fail(`observations[${index}].fresh must be boolean`);
    }
    if (typeof observation.visible !== "boolean") {
      fail(`observations[${index}].visible must be boolean`);
    }
    if (
      !Array.isArray(observation.cohortIds) ||
      observation.cohortIds.some((value) => typeof value !== "string")
    ) {
      fail(`observations[${index}].cohortIds must be a string array`);
    }
    if (
      !Array.isArray(observation.roleFamilyIds) ||
      observation.roleFamilyIds.some((value) => typeof value !== "string")
    ) {
      fail(`observations[${index}].roleFamilyIds must be a string array`);
    }
    if (observation.visible && observation.fulfillmentRoute === "blocked") {
      fail(`observations[${index}] cannot be visible with a blocked route`);
    }
    if (
      countryCode === segment.countryCode &&
      observation.cohortIds.map((value) => value.trim().toLowerCase()).includes(segment.cohortId) &&
      observation.roleFamilyIds
        .map((value) => value.trim().toLowerCase())
        .includes(segment.roleFamilyId)
    ) {
      matching.push({ ...observation, canonicalGroupId, countryCode });
    }
  });

  const fresh = matching.filter((observation) => observation.fresh);
  const visible = matching.filter((observation) => observation.visible);
  const freshVisible = matching.filter((observation) => observation.fresh && observation.visible);
  const freshVisibleByFulfillmentRoute = Object.fromEntries(
    fulfillmentRoutes.map((route) => [
      route,
      freshVisible.filter((observation) => observation.fulfillmentRoute === route).length,
    ]),
  ) as Record<SupplyFulfillmentRoute, number>;

  const baseReady = freshVisible.length >= threshold.minimumFreshVisibleCanonicalGroups;
  const normalizedException = options.exception
    ? normalizeException(options.exception, segment, threshold, evaluatedAt)
    : null;
  const exceptionReady =
    !baseReady &&
    normalizedException?.active === true &&
    freshVisible.length >= normalizedException.minimumFreshVisibleCanonicalGroups;
  const status = baseReady
    ? ("READY" as const)
    : exceptionReady
      ? ("EXCEPTION" as const)
      : ("BLOCKED" as const);
  const failedGates: string[] = [];
  if (status === "BLOCKED") {
    failedGates.push("fresh_visible_canonical_groups_below_approved_minimum");
    if (normalizedException && !normalizedException.active) {
      failedGates.push("supply_exception_expired");
    } else if (normalizedException) {
      failedGates.push("fresh_visible_canonical_groups_below_exception_minimum");
    }
  }
  const appliedException =
    exceptionReady && normalizedException
      ? {
          exceptionId: normalizedException.exceptionId,
          name: normalizedException.name,
          segment: normalizedException.segment,
          minimumFreshVisibleCanonicalGroups:
            normalizedException.minimumFreshVisibleCanonicalGroups,
          approvedByProduct: normalizedException.approvedByProduct,
          approvedAt: normalizedException.approvedAt,
          expiresAt: normalizedException.expiresAt,
        }
      : null;
  const unsigned: Omit<SupplyReadinessScorecard, "digest"> = {
    schemaVersion: "hirly.supply-readiness.v1",
    status,
    scoreable: true,
    supplyGateSatisfied: status !== "BLOCKED",
    environment: input.environment,
    evidenceId,
    evidenceBinding,
    generatedAt,
    evaluatedAt,
    freshnessCutoff,
    segment,
    threshold,
    appliedMinimumFreshVisibleCanonicalGroups: appliedException
      ? appliedException.minimumFreshVisibleCanonicalGroups
      : threshold.minimumFreshVisibleCanonicalGroups,
    counts: {
      segmentCanonicalGroups: matching.length,
      freshCanonicalGroups: fresh.length,
      visibleCanonicalGroups: visible.length,
      freshVisibleCanonicalGroups: freshVisible.length,
      freshVisibleByFulfillmentRoute,
    },
    appliedException,
    failedGates,
    blockerReason:
      status === "BLOCKED"
        ? "Supply evidence does not meet the approved threshold or an active Product exception."
        : null,
    safeguards: safeguards(),
  };
  return { ...unsigned, digest: digest(unsigned) };
}
