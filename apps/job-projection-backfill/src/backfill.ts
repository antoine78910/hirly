export const JOB_PROJECTION_BACKFILL_CHECKPOINT_VERSION =
  "hirly.job-projection-backfill-checkpoint.v1" as const;

export interface ProjectionBackfillCheckpoint {
  schemaVersion: typeof JOB_PROJECTION_BACKFILL_CHECKPOINT_VERSION;
  cursor: string | null;
}

export interface ProjectionBackfillScope {
  countryCode?: string;
  provider?: string;
  role?: string;
}

export interface ProjectionBackfillCandidate {
  canonicalGroupId: string;
  provider: string;
  countryCode: string | null;
  roleKeys: string[];
  sourceDigest: string;
}

export interface ProjectionBackfillRepository {
  listCandidates(input: {
    cursor: string | null;
    limit: number;
    scope: ProjectionBackfillScope;
  }): Promise<ProjectionBackfillCandidate[]>;
  enqueue(candidate: ProjectionBackfillCandidate): Promise<"enqueued" | "existing">;
}

export interface ProjectionBackfillProgress {
  schemaVersion: "hirly.job-projection-backfill-progress.v1";
  mode: "dry_run" | "execute";
  requestedLimit: number;
  selected: number;
  eligible: number;
  denied: number;
  enqueued: number;
  existing: number;
  cursorIn: string | null;
  cursorOut: string | null;
  checkpoint: ProjectionBackfillCheckpoint;
  scope: ProjectionBackfillScope;
  deniedGroups: Array<{
    canonicalGroupId: string;
    provider: string;
    countryCode: string | null;
  }>;
}

export interface RunProjectionBackfillOptions {
  repository: ProjectionBackfillRepository;
  execute?: boolean;
  batchSize?: number;
  checkpoint?: ProjectionBackfillCheckpoint | null;
  scope?: ProjectionBackfillScope;
  rollbackDenylist?: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const COUNTRY = /^[A-Z]{2}$/;

function normalizedScope(scope: ProjectionBackfillScope): ProjectionBackfillScope {
  const countryCode = scope.countryCode?.trim().toUpperCase();
  const provider = scope.provider?.trim().toLowerCase();
  const role = scope.role?.trim().toLowerCase();
  if (countryCode && !COUNTRY.test(countryCode)) throw new Error("invalid_country_scope");
  if (provider !== undefined && provider.length === 0) throw new Error("invalid_provider_scope");
  if (role !== undefined && role.length === 0) throw new Error("invalid_role_scope");
  return {
    ...(countryCode ? { countryCode } : {}),
    ...(provider ? { provider } : {}),
    ...(role ? { role } : {}),
  };
}

function denyKeys(values: string[]): Set<string> {
  const keys = new Set<string>();
  for (const value of values) {
    const [provider, countryCode, extra] = value.trim().split(":");
    if (extra !== undefined || !provider || !countryCode) throw new Error("invalid_rollback_denylist");
    const normalizedProvider = provider.toLowerCase();
    const normalizedCountry = countryCode.toUpperCase();
    if (normalizedProvider !== "*" && !/^[a-z0-9_-]+$/.test(normalizedProvider)) {
      throw new Error("invalid_rollback_denylist");
    }
    if (normalizedCountry !== "*" && !COUNTRY.test(normalizedCountry)) {
      throw new Error("invalid_rollback_denylist");
    }
    keys.add(`${normalizedProvider}:${normalizedCountry}`);
  }
  return keys;
}

function denied(candidate: ProjectionBackfillCandidate, keys: Set<string>): boolean {
  const provider = candidate.provider.toLowerCase();
  const country = candidate.countryCode?.toUpperCase() ?? "*";
  return keys.has(`${provider}:${country}`)
    || keys.has(`${provider}:*`)
    || keys.has(`*:${country}`)
    || keys.has("*:*");
}

function assertCheckpoint(checkpoint: ProjectionBackfillCheckpoint | null | undefined): string | null {
  if (!checkpoint) return null;
  if (checkpoint.schemaVersion !== JOB_PROJECTION_BACKFILL_CHECKPOINT_VERSION) {
    throw new Error("invalid_checkpoint_version");
  }
  if (checkpoint.cursor !== null && !UUID.test(checkpoint.cursor)) {
    throw new Error("invalid_checkpoint_cursor");
  }
  return checkpoint.cursor;
}

function assertCandidate(candidate: ProjectionBackfillCandidate): void {
  if (!UUID.test(candidate.canonicalGroupId)) throw new Error("invalid_candidate_group_id");
  if (!candidate.provider.trim()) throw new Error("invalid_candidate_provider");
  if (candidate.countryCode !== null && !COUNTRY.test(candidate.countryCode)) {
    throw new Error("invalid_candidate_country");
  }
  if (!DIGEST.test(candidate.sourceDigest)) throw new Error("invalid_candidate_digest");
}

export async function runProjectionBackfill(
  options: RunProjectionBackfillOptions,
): Promise<ProjectionBackfillProgress> {
  const batchSize = options.batchSize ?? 100;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error("invalid_batch_size");
  }
  const scope = normalizedScope(options.scope ?? {});
  const cursorIn = assertCheckpoint(options.checkpoint);
  const denylist = denyKeys(options.rollbackDenylist ?? []);
  const selected = await options.repository.listCandidates({
    cursor: cursorIn,
    limit: batchSize,
    scope,
  });
  if (selected.length > batchSize) throw new Error("repository_exceeded_batch_limit");
  for (const candidate of selected) assertCandidate(candidate);

  const deniedGroups = selected.filter((candidate) => denied(candidate, denylist));
  const eligible = selected.filter((candidate) => !denied(candidate, denylist));
  let enqueued = 0;
  let existing = 0;
  if (options.execute === true) {
    for (const candidate of eligible) {
      const outcome = await options.repository.enqueue(candidate);
      if (outcome === "enqueued") enqueued += 1;
      else existing += 1;
    }
  }
  const cursorOut = selected.at(-1)?.canonicalGroupId ?? cursorIn;
  return {
    schemaVersion: "hirly.job-projection-backfill-progress.v1",
    mode: options.execute === true ? "execute" : "dry_run",
    requestedLimit: batchSize,
    selected: selected.length,
    eligible: eligible.length,
    denied: deniedGroups.length,
    enqueued,
    existing,
    cursorIn,
    cursorOut,
    checkpoint: {
      schemaVersion: JOB_PROJECTION_BACKFILL_CHECKPOINT_VERSION,
      cursor: cursorOut,
    },
    scope,
    deniedGroups: deniedGroups.map(({ canonicalGroupId, provider, countryCode }) => ({
      canonicalGroupId,
      provider,
      countryCode,
    })),
  };
}
