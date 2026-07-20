import { createHash } from "node:crypto";

export type TrialStatus = "COMPLETE" | "BLOCKED_EXTERNAL";

export interface TrialJob {
  provider: string;
  tenant: string;
  externalId: string;
  canonicalGroupId?: string;
  fingerprint: string;
  fresh: boolean;
  relevant: boolean;
  actionable: boolean;
  applyUrlKind: "canonical" | "redirect" | "discovery" | "missing";
  knownApplicationRoute: boolean;
  available: boolean;
  matchedUserIds: string[];
}

export interface TrialBaseline {
  schemaVersion: 1;
  status: TrialStatus;
  sample: boolean;
  cohortId: string;
  cohortDigest: string;
  policyDigest: string;
  controlDigest: string;
  paidUserIds: string[];
  currentJobs: TrialJob[];
  expectedRequests: number;
  expectedCostMinor: number;
}

export interface TrialSnapshot {
  schemaVersion: 1;
  status: TrialStatus;
  sample: boolean;
  snapshotId: string;
  capturedAt: string;
  complete: boolean;
  cohortDigest: string;
  policyDigest: string;
  controlDigest: string;
  requests: number;
  costMinor: number;
  jobs: TrialJob[];
}

export interface Percentiles {
  p10: number;
  p50: number;
  p90: number;
}

export interface ProviderTenantScore {
  provider: string;
  tenant: string;
  primaryMetric: number;
  jobsPerPaidUser: Percentiles;
  feedExhaustionRate: number;
  canonicalApplyUrlRate: number;
  knownApplicationRouteRate: number;
  duplicateRate: number;
  unavailableRate: number;
  affectedUsers: number;
  sourceConcentration: number;
  uniqueActionableJobs: number;
}

export interface SnapshotReconciliation {
  fromSnapshotId: string;
  toSnapshotId: string;
  additions: string[];
  removals: string[];
}

export interface TrialScorecard {
  schemaVersion: 1;
  status: "COMPLETE";
  cohortId: string;
  runs: number;
  providers: ProviderTenantScore[];
  reconciliation: SnapshotReconciliation[];
  requestCost: {
    expectedRequests: number;
    actualRequests: number;
    requestsMatch: boolean;
    expectedCostMinor: number;
    actualCostMinor: number;
    costMatch: boolean;
  };
  digest: string;
}

const fail = (message: string): never => {
  throw new Error(`TRIAL_SCORECARD_REFUSED: ${message}`);
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${path} must be a non-empty string`);
  return value as string;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(`${path} must be boolean`);
  return value as boolean;
}

function requireNonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(`${path} must be a non-negative integer`);
  return value as number;
}

function parseJob(value: unknown, path: string): TrialJob {
  if (!isRecord(value)) fail(`${path} must be an object`);
  const record = value as Record<string, unknown>;
  const kind = requireString(record.applyUrlKind, `${path}.applyUrlKind`);
  if (!["canonical", "redirect", "discovery", "missing"].includes(kind)) {
    fail(`${path}.applyUrlKind is invalid`);
  }
  if (!Array.isArray(record.matchedUserIds)) fail(`${path}.matchedUserIds must be an array`);
  const matchedUserIds = (record.matchedUserIds as unknown[]).map((id, index) =>
    requireString(id, `${path}.matchedUserIds[${index}]`),
  );
  if (new Set(matchedUserIds).size !== matchedUserIds.length) fail(`${path}.matchedUserIds contains duplicates`);
  return {
    provider: requireString(record.provider, `${path}.provider`),
    tenant: requireString(record.tenant, `${path}.tenant`),
    externalId: requireString(record.externalId, `${path}.externalId`),
    ...(record.canonicalGroupId === undefined
      ? {}
      : { canonicalGroupId: requireString(record.canonicalGroupId, `${path}.canonicalGroupId`) }),
    fingerprint: requireString(record.fingerprint, `${path}.fingerprint`),
    fresh: requireBoolean(record.fresh, `${path}.fresh`),
    relevant: requireBoolean(record.relevant, `${path}.relevant`),
    actionable: requireBoolean(record.actionable, `${path}.actionable`),
    applyUrlKind: kind as TrialJob["applyUrlKind"],
    knownApplicationRoute: requireBoolean(record.knownApplicationRoute, `${path}.knownApplicationRoute`),
    available: requireBoolean(record.available, `${path}.available`),
    matchedUserIds,
  };
}

export function parseTrialBaseline(value: unknown): TrialBaseline {
  if (!isRecord(value)) fail("baseline must be an object");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) fail("baseline.schemaVersion must equal 1");
  if (record.status !== "COMPLETE") fail("baseline status must be COMPLETE (BLOCKED_EXTERNAL is not scoreable)");
  if (record.sample !== false) fail("baseline sample must be false");
  if (!Array.isArray(record.paidUserIds) || record.paidUserIds.length === 0) {
    fail("baseline.paidUserIds must be a non-empty array");
  }
  if (!Array.isArray(record.currentJobs)) fail("baseline.currentJobs must be an array");
  const paidUserIds = (record.paidUserIds as unknown[]).map((id, index) =>
    requireString(id, `baseline.paidUserIds[${index}]`),
  );
  if (new Set(paidUserIds).size !== paidUserIds.length) fail("baseline.paidUserIds contains duplicates");
  return {
    schemaVersion: 1,
    status: "COMPLETE",
    sample: false,
    cohortId: requireString(record.cohortId, "baseline.cohortId"),
    cohortDigest: requireString(record.cohortDigest, "baseline.cohortDigest"),
    policyDigest: requireString(record.policyDigest, "baseline.policyDigest"),
    controlDigest: requireString(record.controlDigest, "baseline.controlDigest"),
    paidUserIds,
    currentJobs: (record.currentJobs as unknown[]).map((job, index) => parseJob(job, `baseline.currentJobs[${index}]`)),
    expectedRequests: requireNonNegativeInteger(record.expectedRequests, "baseline.expectedRequests"),
    expectedCostMinor: requireNonNegativeInteger(record.expectedCostMinor, "baseline.expectedCostMinor"),
  };
}

export function parseTrialSnapshots(value: unknown): TrialSnapshot[] {
  if (!Array.isArray(value) || value.length === 0) fail("snapshots must contain at least one run");
  return (value as unknown[]).map((entry, index) => {
    const path = `snapshots[${index}]`;
    if (!isRecord(entry)) fail(`${path} must be an object`);
    const record = entry as Record<string, unknown>;
    if (record.schemaVersion !== 1) fail(`${path}.schemaVersion must equal 1`);
    if (record.status !== "COMPLETE") fail(`${path} status must be COMPLETE (BLOCKED_EXTERNAL is not scoreable)`);
    if (record.sample !== false) fail(`${path}.sample must be false`);
    if (record.complete !== true) fail(`${path}.complete must be true`);
    if (!Array.isArray(record.jobs) || record.jobs.length === 0) {
      fail(`${path}.jobs must contain at least one observed job; zero-volume runs are not complete snapshots`);
    }
    const capturedAt = requireString(record.capturedAt, `${path}.capturedAt`);
    if (!Number.isFinite(Date.parse(capturedAt))) fail(`${path}.capturedAt must be an ISO timestamp`);
    return {
      schemaVersion: 1,
      status: "COMPLETE",
      sample: false,
      snapshotId: requireString(record.snapshotId, `${path}.snapshotId`),
      capturedAt,
      complete: true,
      cohortDigest: requireString(record.cohortDigest, `${path}.cohortDigest`),
      policyDigest: requireString(record.policyDigest, `${path}.policyDigest`),
      controlDigest: requireString(record.controlDigest, `${path}.controlDigest`),
      requests: requireNonNegativeInteger(record.requests, `${path}.requests`),
      costMinor: requireNonNegativeInteger(record.costMinor, `${path}.costMinor`),
      jobs: (record.jobs as unknown[]).map((job, jobIndex) => parseJob(job, `${path}.jobs[${jobIndex}]`)),
    };
  });
}

const round = (value: number): number => Number(value.toFixed(6));
const rate = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : round(numerator / denominator);

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return round(sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower));
}

function identityKeys(job: TrialJob): string[] {
  return [
    ...(job.canonicalGroupId ? [`group:${job.canonicalGroupId}`] : []),
    `fingerprint:${job.fingerprint}`,
  ];
}

function stableJobId(job: TrialJob): string {
  return `${job.provider}:${job.tenant}:${job.externalId}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonicalize)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function stableDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function eligible(job: TrialJob): boolean {
  return job.fresh && job.relevant && job.actionable && job.available;
}

export function buildTrialScorecard(
  baselineInput: unknown,
  snapshotsInput: unknown,
): TrialScorecard {
  const baseline = parseTrialBaseline(baselineInput);
  const snapshots = parseTrialSnapshots(snapshotsInput);
  const snapshotIds = new Set<string>();
  for (const snapshot of snapshots) {
    if (snapshotIds.has(snapshot.snapshotId)) fail(`duplicate snapshotId ${snapshot.snapshotId}`);
    snapshotIds.add(snapshot.snapshotId);
    if (
      snapshot.cohortDigest !== baseline.cohortDigest ||
      snapshot.policyDigest !== baseline.policyDigest ||
      snapshot.controlDigest !== baseline.controlDigest
    ) {
      fail(`snapshot ${snapshot.snapshotId} digest controls do not match baseline`);
    }
  }
  const users = [...baseline.paidUserIds].sort();
  const userSet = new Set(users);
  for (const snapshot of snapshots) {
    for (const job of snapshot.jobs) {
      if (job.matchedUserIds.some((id) => !userSet.has(id))) {
        fail(`snapshot ${snapshot.snapshotId} contains a user outside the cohort`);
      }
    }
  }

  const baselineKeys = new Set(baseline.currentJobs.flatMap(identityKeys));
  const orderedSnapshots = [...snapshots].sort(
    (a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.snapshotId.localeCompare(b.snapshotId),
  );
  const providerAccumulator = new Map<
    string,
    { provider: string; tenant: string; userCounts: number[]; raw: number; duplicates: number; unavailable: number;
      canonical: number; knownRoute: number; eligibleUnique: number; affected: Set<string> }
  >();
  const runIdentitySets: { id: string; identities: Set<string> }[] = [];
  let allUniqueEligible = 0;

  for (const [snapshotIndex, snapshot] of orderedSnapshots.entries()) {
    const sortedJobs = [...snapshot.jobs].sort((a, b) => stableJobId(a).localeCompare(stableJobId(b)));
    const claimed = new Set<string>();
    const uniqueByProvider = new Map<string, TrialJob[]>();
    const identitySet = new Set<string>();
    for (const job of sortedJobs) {
      const key = `${job.provider}\u0000${job.tenant}`;
      const accumulator = providerAccumulator.get(key) ?? {
        provider: job.provider, tenant: job.tenant,
        userCounts: Array(snapshotIndex * users.length).fill(0) as number[],
        raw: 0, duplicates: 0,
        unavailable: 0, canonical: 0, knownRoute: 0, eligibleUnique: 0, affected: new Set<string>(),
      };
      accumulator.raw += 1;
      if (!job.available) accumulator.unavailable += 1;
      const keys = identityKeys(job);
      const duplicate = keys.some((candidate) => baselineKeys.has(candidate) || claimed.has(candidate));
      if (duplicate) {
        accumulator.duplicates += 1;
      } else {
        keys.forEach((candidate) => claimed.add(candidate));
        identitySet.add(keys[0]!);
        if (eligible(job)) {
          accumulator.eligibleUnique += 1;
          allUniqueEligible += 1;
          if (job.applyUrlKind === "canonical") accumulator.canonical += 1;
          if (job.knownApplicationRoute) accumulator.knownRoute += 1;
          uniqueByProvider.set(key, [...(uniqueByProvider.get(key) ?? []), job]);
        }
      }
      providerAccumulator.set(key, accumulator);
    }
    for (const [key, accumulator] of providerAccumulator) {
      const jobs = uniqueByProvider.get(key) ?? [];
      for (const userId of users) {
        const count = jobs.filter((job) => job.matchedUserIds.includes(userId)).length;
        accumulator.userCounts.push(count);
        if (count > 0) accumulator.affected.add(userId);
      }
    }
    runIdentitySets.push({ id: snapshot.snapshotId, identities: identitySet });
  }

  const providers = [...providerAccumulator.values()]
    .map((entry): ProviderTenantScore => {
      const p10 = percentile(entry.userCounts, 0.1);
      const p50 = percentile(entry.userCounts, 0.5);
      const p90 = percentile(entry.userCounts, 0.9);
      return {
        provider: entry.provider,
        tenant: entry.tenant,
        primaryMetric: p50,
        jobsPerPaidUser: { p10, p50, p90 },
        feedExhaustionRate: rate(entry.userCounts.filter((count) => count === 0).length, entry.userCounts.length),
        canonicalApplyUrlRate: rate(entry.canonical, entry.eligibleUnique),
        knownApplicationRouteRate: rate(entry.knownRoute, entry.eligibleUnique),
        duplicateRate: rate(entry.duplicates, entry.raw),
        unavailableRate: rate(entry.unavailable, entry.raw),
        affectedUsers: entry.affected.size,
        sourceConcentration: rate(entry.eligibleUnique, allUniqueEligible),
        uniqueActionableJobs: entry.eligibleUnique,
      };
    })
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.tenant.localeCompare(b.tenant));

  const reconciliation = runIdentitySets.slice(1).map((current, index): SnapshotReconciliation => {
    const previous = runIdentitySets[index]!;
    return {
      fromSnapshotId: previous.id,
      toSnapshotId: current.id,
      additions: [...current.identities].filter((id) => !previous.identities.has(id)).sort(),
      removals: [...previous.identities].filter((id) => !current.identities.has(id)).sort(),
    };
  });
  const actualRequests = orderedSnapshots.reduce((sum, snapshot) => sum + snapshot.requests, 0);
  const actualCostMinor = orderedSnapshots.reduce((sum, snapshot) => sum + snapshot.costMinor, 0);
  const unsigned = {
    schemaVersion: 1 as const,
    status: "COMPLETE" as const,
    cohortId: baseline.cohortId,
    runs: orderedSnapshots.length,
    providers,
    reconciliation,
    requestCost: {
      expectedRequests: baseline.expectedRequests,
      actualRequests,
      requestsMatch: baseline.expectedRequests === actualRequests,
      expectedCostMinor: baseline.expectedCostMinor,
      actualCostMinor,
      costMatch: baseline.expectedCostMinor === actualCostMinor,
    },
  };
  return { ...unsigned, digest: stableDigest(unsigned) };
}
