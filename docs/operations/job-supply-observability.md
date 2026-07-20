# G008 job-supply observability operations

Classification: `TS_NEW`.

This runbook is the operator boundary for PR2 of the French job-supply plan. It
does not activate a source, transfer provider ownership, fetch France Travail,
or mutate canonical jobs.

## Safety contract

- `provider_registry.writer_runtime` remains the only canonical-writer
  authority.
- Every new source and policy starts disabled.
- Policy activation rejects already-expired evidence. Source activation requires
  an enabled, authorized provider and a current approved production policy with
  commercial-use and redisplay permission.
- `career_sources` has no writer-runtime field. Source activation never assigns
  or transfers provider writer ownership.
- Run measurement SQL with a read-only database role.
- The census runner may write immutable audit evidence only. It must not write
  `jobs`, enable a provider/source/schedule, or call a provider writer.
- No production credential, CV text, application payload, raw profile text, or
  unhashed user identifier belongs in an artifact or log.
- Persisted `cohort_dimensions` accept only `country_code`,
  `subscription_tier`, `experience_band`, `activity_band`, and
  `inventory_segment`, with bounded primitive values. Free-form role, location,
  search, CV, and application data are rejected by the database constraint.
- Missing topology, credentials, migration, or PR1 aggregate inputs is
  `BLOCKED_EXTERNAL`, never an invented zero or successful census.

## Applied-topology preflight

The physical database used for measurement must contain `jobs`,
`provider_registry`, `source_policy`, `career_sources`, `worker_runs`,
`worker_run_partitions`, `paid_user_inventory_snapshots`,
`paid_user_source_contributions`, and the
`career_source_activation_status` safety view.

Before measurement, capture:

```sql
SELECT current_database(), to_regclass('public.jobs'),
  to_regclass('public.worker_runs'),
  to_regclass('public.worker_run_partitions');

SELECT provider, enabled, writer_runtime, authorization_status
FROM public.provider_registry
ORDER BY provider;

SELECT provider, source_key, enabled, policy_status, production_eligible
FROM public.career_source_activation_status
ORDER BY provider, source_key;
```

Stop if the canonical database is ambiguous or if any provider has two
authoritative writers. The G008 migration must not change the before/after
provider-registry rows.

Apply only after the worker foundation and ingestion-ledger migrations:

```bash
psql "$JOBS_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/db/migrations/20260720000400_job_supply_observability.sql
```

## Reproduce operator measurements

Use a fixed UTC freshness cutoff, measurement window, and PR1 coverage run:

```bash
psql "$JOBS_DATABASE_URL" \
  -v freshness_cutoff="2026-07-13T00:00:00Z" \
  -v window_start="2026-07-01T00:00:00Z" \
  -v window_end="2026-07-15T00:00:00Z" \
  -v coverage_run_id="00000000-0000-0000-0000-000000000000" \
  -f scripts/job-supply-observability.sql \
  | tee artifacts/job-ingestion/job-supply-observability.txt
```

The script runs in a read-only transaction and reports:

1. applied topology plus provider/source/policy safety state;
2. source inventory, freshness, actionability, known routes and duplicate proxy;
3. apply-host/ATS counts used for connector ranking;
4. paid-user P10/P50/P90, median and feed exhaustion;
5. actionable source concentration;
6. run/partition completeness and request cost;
7. France Travail stage reconciliation;
8. cost per incremental fresh, relevant, actionable canonical group.

Treat the pre-group fingerprint duplicate rate as an estimate. Do not use total
job rows as a rollout gate.

## France Travail census execution contract

### Frozen definition

Create the definition before observing results. Canonicalize JSON object keys
and array ordering, then SHA-256 the definition as `definitionDigest`.

Required definition fields:

```text
schemaVersion
generatedAt
paidCohortSnapshot: { evaluatedAt, digest, evaluatorVersion }
profileStrata: [{ dimensions, weight }]
sampling: { mode, deterministicSeed, sampledProfiles, totalEligibleProfiles }
partitionRules:
  publicationWindows
  romeFamiliesOrOccupations
  departmentsOrRegions
  contractTypes
  sourceCap
  pageSize
  splitOrder
partitions:
  partitionId
  publicationWindow
  romeCode
  geography
  contractType
definitionDigest
```

Only allowlisted aggregate strata are permitted: contract, role family,
seniority band, geography band and freshness window. Free-form profile fields
are forbidden. If sampling is unnecessary, record `mode = "all"` and a null
seed rather than omitting the decision.

### Partition execution evidence

Every partition records:

```text
partitionId
runId
status: completed_with_results | completed_zero_results | capped | blocked | failed
sourceReportedTotal
fetchedRecords
normalizedRecords
rejectedRecords
actionableRecords
requestCount
retryCount
cursorOrRangeHistory
terminalReason
startedAt
finishedAt
```

The definition is immutable. Execution evidence may append terminal partition
results, but cannot change cohort, weights, sampling, cap/window rules, or
partition boundaries after results are seen.

### Terminal rules

Mark a census `complete` only when:

- every frozen partition is terminal-complete;
- no partition hit the retrievable cap;
- every complete partition has a non-null source-reported total;
- fetched external IDs are unique within the partition;
- `fetchedRecords = normalizedRecords + rejectedRecords`;
- `actionableRecords <= normalizedRecords`;
- partition totals reconcile to the source-reported total;
- every evidence `runId` is durably linked to `worker_runs`;
- no credentials or user-sensitive payloads occur in evidence.

Otherwise use:

- `capped` for a cap hit or source-total mismatch requiring a frozen child
  partition;
- `blocked` for missing authorization, credentials, topology, PR1 aggregates,
  or externally unavailable API capability;
- `failed` for a terminal execution or accounting failure.

Never convert a capped, blocked, partial or failed result into zero. Never use
an incomplete census to expire inventory.

### Immutable artifact

After every partition is terminal, create an evidence object containing the
unchanged definition, ordered partition evidence, aggregate counts,
`terminalState`, and `definitionDigest`. Canonicalize and SHA-256 the complete
object as `evidenceDigest`.

The frozen API-request definition and the reconciled database evidence are two
different versioned artifacts:

- `census-cli.ts` consumes the frozen definition (`manifestDigest`) and writes
  provider-response evidence without mutating the database.
- `collectLiveJobSupplyReport` builds the reconciled ledger evidence (`digest`)
  and is the only application boundary that may persist it.

Persist reconciled evidence with the PR1 `coverage_run_id` that fixed the paid
cohort. The manifest row stores that foreign key; each included France Travail
run is stored in `france_travail_census_manifest_runs`. There is no
`source_run_ids` array column. A repeated identical digest is idempotent, and
update/delete is forbidden. A missing source-reported total is `blocked`, not a
complete zero-result census.

Export the same JSON under `artifacts/job-ingestion/` for review. The FT-PY
versus FT-TS decision must cite both definition and evidence digests and may not
redefine the cohort or partitions.

## Live-run gate

No live credentialed census is part of this implementation lane. When an
authorized operator later runs the audit app:

1. capture provider-registry rows and applied topology;
2. verify every new source/policy/schedule is disabled;
3. run dry mode first and inspect definition/partition digests;
4. execute only the frozen manifest;
5. persist immutable evidence after reconciliation;
6. rerun `scripts/job-supply-observability.sql`;
7. confirm jobs and provider-registry checksums are unchanged.

If any check fails, stop and record `BLOCKED_EXTERNAL` or the terminal failure.

## Rollback

1. Stop the census/audit command; no source schedule should be active.
2. Preserve exported definition/evidence digests for audit.
3. Roll back only the additive G008 migration using its paired down migration.
4. Re-run topology and provider-registry queries.
5. Confirm writer ownership and all canonical job rows are unchanged.

The paired down migration is destructive and is only for an isolated test
database:

```bash
psql "$TEST_JOBS_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/db/migrations/20260720000400_job_supply_observability.down.sql
```
