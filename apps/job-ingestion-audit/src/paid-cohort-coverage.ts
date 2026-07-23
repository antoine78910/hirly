import { createHash } from "node:crypto";

export interface PaidCohortMember {
  hashedUserId: string;
  cohortDimensions: Record<string, string | number | boolean | null>;
  roleTokens: string[];
  countryCodes: string[];
  seenCanonicalGroupDigests: string[];
}

export interface TrialSourceBinding {
  trialRunId: string;
  sourceId: string;
  provider: string;
  tenantKey: string;
}

export interface CoverageCandidate {
  canonicalGroupDigest: string;
  sourceId: string | null;
  provider: string;
  tenantKey: string | null;
  titleTokens: string[];
  countryCode: string | null;
  freshAt: string;
  actionable: boolean;
  routeKnown: boolean;
  directEmployer: boolean;
}

export interface PaidCohortCoverageInput {
  coverageRunId: string;
  generatedAt: string;
  freshnessCutoff: string;
  freshnessWindowDays: 1 | 7 | 30;
  evaluatorVersion: string;
  cohort: PaidCohortMember[];
  trialSources: TrialSourceBinding[];
}

export interface PersistedInventorySnapshot {
  hashedUserId: string;
  evaluatedAt: string;
  cohortDimensions: Record<string, string | number | boolean | null>;
  sourceSet: string[];
  freshnessWindowDays: 1 | 7 | 30;
  relevantTotal: number;
  uniqueTotal: number;
  actionableTotal: number;
  unseenActionableTotal: number;
  routeKnownTotal: number;
  directEmployerTotal: number;
  terminalReason: "complete";
  evaluatorVersion: string;
}

export interface PersistedSourceContribution {
  sourceId: string;
  canonicalGroupId: string;
  affectedPaidUsers: number;
  incremental: boolean;
  fresh: boolean;
  relevant: boolean;
  actionable: boolean;
}

export interface CoverageEvidence {
  coverageRunId: string;
  generatedAt: string;
  cohortDigest: string;
  evidenceDigest: string;
  summary: Record<string, unknown>;
  snapshots: PersistedInventorySnapshot[];
  contributions: PersistedSourceContribution[];
}

export interface PaidCohortCoverageStore {
  loadCurrentCandidates(freshnessCutoff: string): Promise<CoverageCandidate[]>;
  loadTrialCandidates(
    bindings: TrialSourceBinding[],
    generatedAt: string,
  ): Promise<CoverageCandidate[]>;
  persistEvidence(evidence: CoverageEvidence): Promise<"persisted" | "idempotent">;
}

export interface PaidCohortCoverageReport {
  schemaVersion: "hirly.paid-user-inventory-coverage.v1";
  status: "COMPLETE";
  generatedAt: string;
  freshnessCutoff: string;
  freshnessWindowDays: 1 | 7 | 30;
  cohortSize: number;
  cohortDigest: string;
  trialSourceCount: number;
  trialSourceDigest: string;
  snapshotsPersisted: number;
  contributionsPersisted: number;
  relevantTotal: number;
  actionableTotal: number;
  unseenActionableTotal: number;
  evidenceDigest: string;
  persistence: "persisted" | "idempotent";
}

const sha256Pattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeDimensionKeys = new Set([
  "country_code",
  "subscription_tier",
  "experience_band",
  "activity_band",
  "inventory_segment",
]);

function refuse(reason: string): never {
  throw new Error(`PAID_COHORT_COVERAGE_REFUSED: ${reason}`);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function coverageDigest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function text(value: string, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    refuse(`${path} must be a non-empty string`);
  }
  return value.trim();
}

function timestamp(value: string, path: string): string {
  const normalized = text(value, path);
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds) || !/[zZ]|[+-]\d{2}:\d{2}$/.test(normalized)) {
    refuse(`${path} must be an ISO timestamp with an explicit timezone`);
  }
  return new Date(milliseconds).toISOString();
}

function uuid(value: string, path: string): string {
  const normalized = text(value, path).toLowerCase();
  if (!uuidPattern.test(normalized)) refuse(`${path} must be a UUID`);
  return normalized;
}

function digestValue(value: string, path: string): string {
  const normalized = text(value, path).toLowerCase();
  if (!sha256Pattern.test(normalized)) refuse(`${path} must be a SHA-256 digest`);
  return normalized;
}

function tokens(values: string[], path: string): string[] {
  if (!Array.isArray(values)) refuse(`${path} must be an array`);
  return [
    ...new Set(
      values.map((value, index) =>
        text(value, `${path}[${index}]`)
          .normalize("NFKD")
          .replace(/\p{Diacritic}/gu, "")
          .toLowerCase(),
      ),
    ),
  ].sort();
}

function normalizeInput(input: PaidCohortCoverageInput): PaidCohortCoverageInput {
  const coverageRunId = uuid(input.coverageRunId, "coverageRunId");
  const generatedAt = timestamp(input.generatedAt, "generatedAt");
  const freshnessCutoff = timestamp(input.freshnessCutoff, "freshnessCutoff");
  if (![1, 7, 30].includes(input.freshnessWindowDays)) {
    refuse("freshnessWindowDays must be 1, 7, or 30");
  }
  const expectedWindowMs = input.freshnessWindowDays * 86_400_000;
  if (Date.parse(generatedAt) - Date.parse(freshnessCutoff) !== expectedWindowMs) {
    refuse("freshnessCutoff must exactly match the declared freshness window");
  }
  if (!Array.isArray(input.cohort) || input.cohort.length === 0) {
    refuse("cohort must contain at least one paid user");
  }
  const cohort = input.cohort
    .map((member, index) => {
      const dimensions = member.cohortDimensions ?? {};
      for (const [key, value] of Object.entries(dimensions)) {
        if (!safeDimensionKeys.has(key)) refuse(`cohort[${index}] has unsafe dimension ${key}`);
        if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
          refuse(`cohort[${index}].cohortDimensions.${key} is not aggregate-safe`);
        }
        if (String(value ?? "").length > 64) {
          refuse(`cohort[${index}].cohortDimensions.${key} exceeds 64 characters`);
        }
      }
      const roleTokens = tokens(member.roleTokens, `cohort[${index}].roleTokens`);
      if (roleTokens.length === 0) refuse(`cohort[${index}] requires role tokens`);
      if (!Array.isArray(member.seenCanonicalGroupDigests)) {
        refuse(`cohort[${index}].seenCanonicalGroupDigests must be an array`);
      }
      return {
        hashedUserId: digestValue(member.hashedUserId, `cohort[${index}].hashedUserId`),
        cohortDimensions: Object.fromEntries(
          Object.entries(dimensions).sort(([left], [right]) => left.localeCompare(right)),
        ),
        roleTokens,
        countryCodes: tokens(member.countryCodes, `cohort[${index}].countryCodes`).map((country) =>
          country.toUpperCase(),
        ),
        seenCanonicalGroupDigests: member.seenCanonicalGroupDigests
          .map((entry, digestIndex) =>
            digestValue(entry, `cohort[${index}].seenCanonicalGroupDigests[${digestIndex}]`),
          )
          .sort(),
      };
    })
    .sort((left, right) => left.hashedUserId.localeCompare(right.hashedUserId));
  if (new Set(cohort.map((member) => member.hashedUserId)).size !== cohort.length) {
    refuse("cohort contains duplicate hashed user IDs");
  }

  if (!Array.isArray(input.trialSources) || input.trialSources.length === 0) {
    refuse("trialSources must contain at least one bound trial source");
  }
  const trialSources = input.trialSources
    .map((binding, index) => ({
      trialRunId: uuid(binding.trialRunId, `trialSources[${index}].trialRunId`),
      sourceId: uuid(binding.sourceId, `trialSources[${index}].sourceId`),
      provider: text(binding.provider, `trialSources[${index}].provider`).toLowerCase(),
      tenantKey: text(binding.tenantKey, `trialSources[${index}].tenantKey`),
    }))
    .sort((left, right) => left.trialRunId.localeCompare(right.trialRunId));
  if (new Set(trialSources.map((source) => source.trialRunId)).size !== trialSources.length) {
    refuse("trialSources contains duplicate trial run IDs");
  }
  if (
    new Set(
      trialSources.map(
        (source) => `${source.sourceId}\u0000${source.provider}\u0000${source.tenantKey}`,
      ),
    ).size !== trialSources.length
  ) {
    refuse("trialSources contains duplicate provider/source/tenant bindings");
  }
  return {
    coverageRunId,
    generatedAt,
    freshnessCutoff,
    freshnessWindowDays: input.freshnessWindowDays,
    evaluatorVersion: text(input.evaluatorVersion, "evaluatorVersion"),
    cohort,
    trialSources,
  };
}

function normalizeCandidate(candidate: CoverageCandidate, path: string): CoverageCandidate {
  return {
    canonicalGroupDigest: digestValue(
      candidate.canonicalGroupDigest,
      `${path}.canonicalGroupDigest`,
    ),
    sourceId: candidate.sourceId === null ? null : uuid(candidate.sourceId, `${path}.sourceId`),
    provider: text(candidate.provider, `${path}.provider`).toLowerCase(),
    tenantKey: candidate.tenantKey === null ? null : text(candidate.tenantKey, `${path}.tenantKey`),
    titleTokens: tokens(candidate.titleTokens, `${path}.titleTokens`),
    countryCode:
      candidate.countryCode === null
        ? null
        : text(candidate.countryCode, `${path}.countryCode`).toUpperCase(),
    freshAt: timestamp(candidate.freshAt, `${path}.freshAt`),
    actionable: candidate.actionable === true,
    routeKnown: candidate.routeKnown === true,
    directEmployer: candidate.directEmployer === true,
  };
}

function relevant(member: PaidCohortMember, candidate: CoverageCandidate): boolean {
  const roleMatch = candidate.titleTokens.some((token) => member.roleTokens.includes(token));
  const countryMatch =
    member.countryCodes.length === 0 ||
    (candidate.countryCode !== null && member.countryCodes.includes(candidate.countryCode));
  return roleMatch && countryMatch;
}

export async function producePaidCohortCoverage(
  rawInput: PaidCohortCoverageInput,
  store: PaidCohortCoverageStore,
): Promise<PaidCohortCoverageReport> {
  const input = normalizeInput(rawInput);
  const cohortDigest = coverageDigest(input.cohort);
  const trialSourceDigest = coverageDigest(input.trialSources);
  const [currentRaw, trialRaw] = await Promise.all([
    store.loadCurrentCandidates(input.freshnessCutoff),
    store.loadTrialCandidates(input.trialSources, input.generatedAt),
  ]);
  const current = currentRaw.map((candidate, index) =>
    normalizeCandidate(candidate, `currentCandidates[${index}]`),
  );
  const trial = trialRaw.map((candidate, index) =>
    normalizeCandidate(candidate, `trialCandidates[${index}]`),
  );
  for (const candidate of current) {
    if (
      Date.parse(candidate.freshAt) < Date.parse(input.freshnessCutoff) ||
      Date.parse(candidate.freshAt) > Date.parse(input.generatedAt)
    ) {
      refuse("current candidate escaped the frozen freshness window");
    }
  }
  const bindingKeys = new Set(
    input.trialSources.map(
      (binding) => `${binding.sourceId}\u0000${binding.provider}\u0000${binding.tenantKey}`,
    ),
  );
  const verifiedTrial: Array<CoverageCandidate & { sourceId: string; tenantKey: string }> = [];
  for (const candidate of trial) {
    if (candidate.sourceId === null || candidate.tenantKey === null) {
      refuse("trial candidate escaped its provider/source/tenant binding");
    }
    const sourceId = candidate.sourceId;
    const tenantKey = candidate.tenantKey;
    if (!bindingKeys.has(`${sourceId}\u0000${candidate.provider}\u0000${tenantKey}`)) {
      refuse("trial candidate escaped its provider/source/tenant binding");
    }
    if (Date.parse(candidate.freshAt) > Date.parse(input.generatedAt)) {
      refuse("trial candidate freshness timestamp is later than generatedAt");
    }
    verifiedTrial.push({ ...candidate, sourceId, tenantKey });
  }

  const currentGroups = new Set(current.map((candidate) => candidate.canonicalGroupDigest));
  const allCandidates = [...current, ...verifiedTrial].filter(
    (candidate) => Date.parse(candidate.freshAt) >= Date.parse(input.freshnessCutoff),
  );
  const sourceSet = [...new Set(allCandidates.map((candidate) => candidate.provider))].sort();
  const snapshots = input.cohort.map((member) => {
    const groups = new Map<string, CoverageCandidate>();
    for (const candidate of allCandidates) {
      if (!relevant(member, candidate)) continue;
      const existing = groups.get(candidate.canonicalGroupDigest);
      if (!existing) {
        groups.set(candidate.canonicalGroupDigest, candidate);
        continue;
      }
      groups.set(candidate.canonicalGroupDigest, {
        ...existing,
        freshAt:
          Date.parse(candidate.freshAt) > Date.parse(existing.freshAt)
            ? candidate.freshAt
            : existing.freshAt,
        actionable: existing.actionable || candidate.actionable,
        routeKnown: existing.routeKnown || candidate.routeKnown,
        directEmployer: existing.directEmployer || candidate.directEmployer,
      });
    }
    const values = [...groups.values()];
    const actionable = values.filter((candidate) => candidate.actionable);
    const seen = new Set(member.seenCanonicalGroupDigests);
    return {
      hashedUserId: member.hashedUserId,
      evaluatedAt: input.generatedAt,
      cohortDimensions: member.cohortDimensions,
      sourceSet,
      freshnessWindowDays: input.freshnessWindowDays,
      relevantTotal: values.length,
      uniqueTotal: values.length,
      actionableTotal: actionable.length,
      unseenActionableTotal: actionable.filter(
        (candidate) => !seen.has(candidate.canonicalGroupDigest),
      ).length,
      routeKnownTotal: values.filter((candidate) => candidate.routeKnown).length,
      directEmployerTotal: values.filter((candidate) => candidate.directEmployer).length,
      terminalReason: "complete" as const,
      evaluatorVersion: input.evaluatorVersion,
    };
  });

  const trialGroups = new Map<
    string,
    {
      candidate: CoverageCandidate & { sourceId: string; tenantKey: string };
      affected: Set<string>;
    }
  >();
  for (const candidate of verifiedTrial) {
    const key = `${candidate.sourceId}\u0000${candidate.canonicalGroupDigest}`;
    const entry = trialGroups.get(key) ?? { candidate, affected: new Set<string>() };
    for (const member of input.cohort) {
      if (relevant(member, candidate)) entry.affected.add(member.hashedUserId);
    }
    trialGroups.set(key, {
      candidate: {
        ...entry.candidate,
        freshAt:
          Date.parse(candidate.freshAt) > Date.parse(entry.candidate.freshAt)
            ? candidate.freshAt
            : entry.candidate.freshAt,
        actionable: entry.candidate.actionable || candidate.actionable,
        routeKnown: entry.candidate.routeKnown || candidate.routeKnown,
        directEmployer: entry.candidate.directEmployer || candidate.directEmployer,
      },
      affected: entry.affected,
    });
  }
  const contributions = [...trialGroups.values()]
    .map(({ candidate, affected }) => ({
      sourceId: candidate.sourceId,
      canonicalGroupId: candidate.canonicalGroupDigest,
      affectedPaidUsers: affected.size,
      incremental: !currentGroups.has(candidate.canonicalGroupDigest),
      fresh: Date.parse(candidate.freshAt) >= Date.parse(input.freshnessCutoff),
      relevant: affected.size > 0,
      actionable: candidate.actionable,
    }))
    .sort(
      (left, right) =>
        left.sourceId.localeCompare(right.sourceId) ||
        left.canonicalGroupId.localeCompare(right.canonicalGroupId),
    );

  const unsignedSummary = {
    schemaVersion: "hirly.paid-user-inventory-coverage.v1",
    scope: "paid_user_inventory",
    coverageRunId: input.coverageRunId,
    generatedAt: input.generatedAt,
    freshnessCutoff: input.freshnessCutoff,
    freshnessWindowDays: input.freshnessWindowDays,
    evaluatorVersion: input.evaluatorVersion,
    cohortSize: input.cohort.length,
    cohortDigest,
    trialSourceCount: input.trialSources.length,
    trialSourceDigest,
    snapshotsPersisted: snapshots.length,
    contributionsPersisted: contributions.length,
    relevantTotal: snapshots.reduce((sum, snapshot) => sum + snapshot.relevantTotal, 0),
    actionableTotal: snapshots.reduce((sum, snapshot) => sum + snapshot.actionableTotal, 0),
    unseenActionableTotal: snapshots.reduce(
      (sum, snapshot) => sum + snapshot.unseenActionableTotal,
      0,
    ),
  };
  const evidenceDigest = coverageDigest({
    summary: unsignedSummary,
    snapshots,
    contributions,
  });
  const summary = { ...unsignedSummary, evidenceDigest };
  const persistence = await store.persistEvidence({
    coverageRunId: input.coverageRunId,
    generatedAt: input.generatedAt,
    cohortDigest,
    evidenceDigest,
    summary,
    snapshots,
    contributions,
  });
  return {
    ...unsignedSummary,
    schemaVersion: "hirly.paid-user-inventory-coverage.v1",
    status: "COMPLETE",
    evidenceDigest,
    persistence,
  };
}
