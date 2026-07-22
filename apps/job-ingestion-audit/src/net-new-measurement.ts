import { createHash } from "node:crypto";

export interface CurrentInventoryAggregate {
  layeredUniqueJobs: number;
  fresh30dUniqueJobs: number;
  autoApplicableUniqueJobs: number;
  franceTravailUniqueJobs: number;
  franceTravailAutoApplicableJobs: number;
}

export interface SourceNetNewAggregate {
  provider: string;
  tenant: string;
  observedCandidates: number;
  exactOccurrenceDuplicates: number;
  canonicalUrlDuplicates: number;
  atsIdentityDuplicates: number;
  fingerprintDuplicates: number;
  incrementalNetNew: number;
  incrementalFreshRelevantActionable: number;
  incrementalAutoApplicable: number;
  paidUserJobMatches: number;
}

export interface NetNewMeasurementInput {
  status: "COMPLETE" | "BLOCKED_EXTERNAL";
  blockerReason?: string;
  sample: boolean;
  generatedAt: string;
  freshnessCutoff: string;
  coverageRunId: string;
  trialRunIds: string[];
  baseline: CurrentInventoryAggregate;
  sources: SourceNetNewAggregate[];
}

export interface NetNewMeasurementReport {
  schemaVersion: "hirly.multi-source-net-new-measurement.v1";
  status: "COMPLETE";
  generatedAt: string;
  freshnessCutoff: string;
  coverageRunId: string;
  trialRunCount: number;
  trialRunDigest: string;
  baseline: CurrentInventoryAggregate & {
    franceTravailConcentration: number;
    autoApplicableRate: number;
  };
  uplift: {
    incrementalNetNew: number;
    incrementalFreshRelevantActionable: number;
    incrementalAutoApplicable: number;
    paidUserJobMatches: number;
    projectedLayeredUniqueJobs: number;
    projectedAutoApplicableUniqueJobs: number;
    projectedAutoApplicableRate: number;
    autoApplicableRateDelta: number;
    projectedFranceTravailConcentration: number;
    franceTravailConcentrationDelta: number;
  };
  sources: Array<
    SourceNetNewAggregate & {
      duplicateTotal: number;
      duplicateRate: number;
      netNewRate: number;
    }
  >;
  digest: string;
}

const fail = (message: string): never => {
  throw new Error(`NET_NEW_MEASUREMENT_REFUSED: ${message}`);
};

const round = (value: number): number => Number(value.toFixed(8));
const rate = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : round(numerator / denominator);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isoTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i;

function requireCount(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${path} must be a non-negative safe integer`);
  }
  return value;
}

function requireText(value: string, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${path} must be a non-empty string`);
  }
  return value.trim();
}

function requireUuid(value: string, path: string): string {
  const normalized = requireText(value, path);
  if (!uuidPattern.test(normalized)) fail(`${path} must be a UUID`);
  return normalized.toLowerCase();
}

function requireTimestamp(value: string, path: string): string {
  const timestamp = requireText(value, path);
  const milliseconds = Date.parse(timestamp);
  if (!isoTimestampPattern.test(timestamp) || !Number.isFinite(milliseconds)) {
    fail(`${path} must be an ISO timestamp with an explicit timezone`);
  }
  return new Date(milliseconds).toISOString();
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

function validateBaseline(input: CurrentInventoryAggregate): CurrentInventoryAggregate {
  const baseline = {
    layeredUniqueJobs: requireCount(input.layeredUniqueJobs, "baseline.layeredUniqueJobs"),
    fresh30dUniqueJobs: requireCount(input.fresh30dUniqueJobs, "baseline.fresh30dUniqueJobs"),
    autoApplicableUniqueJobs: requireCount(
      input.autoApplicableUniqueJobs,
      "baseline.autoApplicableUniqueJobs",
    ),
    franceTravailUniqueJobs: requireCount(
      input.franceTravailUniqueJobs,
      "baseline.franceTravailUniqueJobs",
    ),
    franceTravailAutoApplicableJobs: requireCount(
      input.franceTravailAutoApplicableJobs,
      "baseline.franceTravailAutoApplicableJobs",
    ),
  };
  if (
    baseline.fresh30dUniqueJobs > baseline.layeredUniqueJobs ||
    baseline.autoApplicableUniqueJobs > baseline.layeredUniqueJobs ||
    baseline.franceTravailUniqueJobs > baseline.layeredUniqueJobs ||
    baseline.franceTravailAutoApplicableJobs > baseline.franceTravailUniqueJobs ||
    baseline.franceTravailAutoApplicableJobs > baseline.autoApplicableUniqueJobs
  ) {
    fail("baseline counters violate aggregate monotonicity");
  }
  return baseline;
}

function validateSource(input: SourceNetNewAggregate, index: number): SourceNetNewAggregate {
  const path = `sources[${index}]`;
  const source = {
    provider: requireText(input.provider, `${path}.provider`),
    tenant: requireText(input.tenant, `${path}.tenant`),
    observedCandidates: requireCount(input.observedCandidates, `${path}.observedCandidates`),
    exactOccurrenceDuplicates: requireCount(
      input.exactOccurrenceDuplicates,
      `${path}.exactOccurrenceDuplicates`,
    ),
    canonicalUrlDuplicates: requireCount(
      input.canonicalUrlDuplicates,
      `${path}.canonicalUrlDuplicates`,
    ),
    atsIdentityDuplicates: requireCount(
      input.atsIdentityDuplicates,
      `${path}.atsIdentityDuplicates`,
    ),
    fingerprintDuplicates: requireCount(
      input.fingerprintDuplicates,
      `${path}.fingerprintDuplicates`,
    ),
    incrementalNetNew: requireCount(input.incrementalNetNew, `${path}.incrementalNetNew`),
    incrementalFreshRelevantActionable: requireCount(
      input.incrementalFreshRelevantActionable,
      `${path}.incrementalFreshRelevantActionable`,
    ),
    incrementalAutoApplicable: requireCount(
      input.incrementalAutoApplicable,
      `${path}.incrementalAutoApplicable`,
    ),
    paidUserJobMatches: requireCount(input.paidUserJobMatches, `${path}.paidUserJobMatches`),
  };
  const classified =
    source.exactOccurrenceDuplicates +
    source.canonicalUrlDuplicates +
    source.atsIdentityDuplicates +
    source.fingerprintDuplicates +
    source.incrementalNetNew;
  if (classified !== source.observedCandidates) {
    fail(`${path} layered dedup accounting does not reconcile`);
  }
  if (
    source.incrementalFreshRelevantActionable > source.incrementalNetNew ||
    source.incrementalAutoApplicable > source.incrementalNetNew
  ) {
    fail(`${path} uplift counters exceed incremental net-new inventory`);
  }
  return source;
}

export function buildNetNewMeasurement(input: NetNewMeasurementInput): NetNewMeasurementReport {
  if (input.status !== "COMPLETE") {
    fail(
      `status ${input.status} is not scoreable: ${input.blockerReason ?? "missing blocker reason"}`,
    );
  }
  if (input.sample !== false) fail("sample evidence is not scoreable");
  const generatedAt = requireTimestamp(input.generatedAt, "generatedAt");
  const freshnessCutoff = requireTimestamp(input.freshnessCutoff, "freshnessCutoff");
  if (Date.parse(generatedAt) < Date.parse(freshnessCutoff)) {
    fail("generatedAt must not precede freshnessCutoff");
  }
  const coverageRunId = requireUuid(input.coverageRunId, "coverageRunId");
  if (!Array.isArray(input.trialRunIds) || input.trialRunIds.length === 0) {
    fail("trialRunIds must contain at least one run");
  }
  const trialRunIds = input.trialRunIds.map((runId, index) =>
    requireUuid(runId, `trialRunIds[${index}]`),
  );
  if (new Set(trialRunIds).size !== trialRunIds.length) {
    fail("trialRunIds contains duplicates");
  }

  const baseline = validateBaseline(input.baseline);
  const sources = input.sources
    .map(validateSource)
    .sort(
      (left, right) =>
        left.provider.localeCompare(right.provider) || left.tenant.localeCompare(right.tenant),
    );
  if (sources.length === 0) fail("sources must contain at least one aggregate row");
  const sourceKeys = sources.map((source) => `${source.provider}\u0000${source.tenant}`);
  if (new Set(sourceKeys).size !== sourceKeys.length) {
    fail("sources contains duplicate provider/tenant aggregates");
  }

  const incrementalNetNew = sources.reduce((sum, source) => sum + source.incrementalNetNew, 0);
  const incrementalFreshRelevantActionable = sources.reduce(
    (sum, source) => sum + source.incrementalFreshRelevantActionable,
    0,
  );
  const incrementalAutoApplicable = sources.reduce(
    (sum, source) => sum + source.incrementalAutoApplicable,
    0,
  );
  const paidUserJobMatches = sources.reduce((sum, source) => sum + source.paidUserJobMatches, 0);
  const franceTravailIncremental = sources
    .filter((source) => source.provider.toLowerCase() === "france_travail")
    .reduce((sum, source) => sum + source.incrementalNetNew, 0);
  const projectedLayeredUniqueJobs = baseline.layeredUniqueJobs + incrementalNetNew;
  const projectedAutoApplicableUniqueJobs =
    baseline.autoApplicableUniqueJobs + incrementalAutoApplicable;
  const baselineFranceTravailConcentration = rate(
    baseline.franceTravailUniqueJobs,
    baseline.layeredUniqueJobs,
  );
  const projectedFranceTravailConcentration = rate(
    baseline.franceTravailUniqueJobs + franceTravailIncremental,
    projectedLayeredUniqueJobs,
  );
  const baselineAutoApplicableRate = rate(
    baseline.autoApplicableUniqueJobs,
    baseline.layeredUniqueJobs,
  );
  const projectedAutoApplicableRate = rate(
    projectedAutoApplicableUniqueJobs,
    projectedLayeredUniqueJobs,
  );
  const unsigned = {
    schemaVersion: "hirly.multi-source-net-new-measurement.v1" as const,
    status: "COMPLETE" as const,
    generatedAt,
    freshnessCutoff,
    coverageRunId,
    trialRunCount: trialRunIds.length,
    trialRunDigest: digest([...trialRunIds].sort()),
    baseline: {
      ...baseline,
      franceTravailConcentration: baselineFranceTravailConcentration,
      autoApplicableRate: baselineAutoApplicableRate,
    },
    uplift: {
      incrementalNetNew,
      incrementalFreshRelevantActionable,
      incrementalAutoApplicable,
      paidUserJobMatches,
      projectedLayeredUniqueJobs,
      projectedAutoApplicableUniqueJobs,
      projectedAutoApplicableRate,
      autoApplicableRateDelta: round(projectedAutoApplicableRate - baselineAutoApplicableRate),
      projectedFranceTravailConcentration,
      franceTravailConcentrationDelta: round(
        projectedFranceTravailConcentration - baselineFranceTravailConcentration,
      ),
    },
    sources: sources.map((source) => {
      const duplicateTotal =
        source.exactOccurrenceDuplicates +
        source.canonicalUrlDuplicates +
        source.atsIdentityDuplicates +
        source.fingerprintDuplicates;
      return {
        ...source,
        duplicateTotal,
        duplicateRate: rate(duplicateTotal, source.observedCandidates),
        netNewRate: rate(source.incrementalNetNew, source.observedCandidates),
      };
    }),
  };
  return { ...unsigned, digest: digest(unsigned) };
}
