# Job-supply observability foundation

Classification: `TS_NEW`.

This G008 foundation adds source-policy, disabled career-source, cohort aggregate,
France Travail census, and source-run metadata to the Postgres database that
owns `public.jobs`. It does not authorize or enable a provider, change a feed,
or transfer canonical writer ownership.

## Invariants

- `provider_registry.writer_runtime` remains the sole writer-runtime authority.
  `career_sources` has no runtime-owner or ownership-epoch column.
- Policies and sources default to `enabled=false`.
- Enabling a policy rejects expired evidence and requires approved commercial
  use, redisplay, production access methods, evidence, reviewer, and expiry.
- Enabling a career source requires an enabled/authorized provider with a
  non-`none` writer and an enabled, approved, unexpired production policy.
- Downgrading a provider or policy disables its currently enabled sources.
- A provider still changes writer only through the existing provider-registry
  operator boundary. Source enablement never assigns a writer.
- `worker_runs` remains the authoritative source-run ledger. No competing
  `source_runs` table is created.
- Cohort dimensions accept only bounded aggregate keys. CV text, role, location,
  search terms, application payloads, and other profile detail are rejected.
- Existing `jobs`, feed reads, Python schedules, and canonical writers are
  unchanged by this migration.

## Apply

Apply the migration to the inventory database after migrations `00100`,
`00200`, and `00300`:

```bash
psql "$JOBS_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/db/migrations/20260720000400_job_supply_observability.sql
```

Preflight the physical topology:

```sql
SELECT
  current_database() AS database_name,
  to_regclass('public.jobs') AS jobs_table,
  to_regclass('public.provider_registry') AS provider_registry,
  to_regclass('public.worker_runs') AS worker_runs,
  to_regclass('public.worker_run_partitions') AS worker_run_partitions;

SELECT provider, authorization_status, enabled, writer_runtime
FROM public.provider_registry
ORDER BY provider;
```

Stop if the target is not the physical inventory database or any prerequisite
object is missing.

## Added metadata

- `source_policy`: reviewed access, commercial-use, redisplay, retention,
  attribution, evidence/agreement reference, review, expiry, and environment
  gates.
- `career_sources`: provider source/tenant identity, company/country metadata,
  access type, policy, cadence, checkpoint, health, and disabled discovery
  state.
- `worker_runs`: source, mode, normalized scope, checkpoints, requests, bytes,
  duration, cost, actionable count, residuals, and immutable planned/complete
  scope tokens.
- `paid_user_inventory_snapshots`: pseudonymous per-run aggregate coverage with
  an allowlisted cohort-dimension contract.
- `paid_user_source_contributions`: aggregate source/group contribution facts.
- `france_travail_census_manifests`: immutable, reconciled census evidence and
  explicit run membership.
- Read-only source, ATS-host, paid-user, and activation-status views.

Runtime roles have no insert/update grant on `source_policy` or
`career_sources`. This phase records foundation metadata through a migration or
database-owner operation only. A future activation change must add a reviewed,
least-privilege operator RPC rather than grant direct table mutation.

## Post-migration checks

The provider-registry rows must match the preflight snapshot, and every new
policy/source must remain disabled until explicitly reviewed:

```sql
SELECT provider, authorization_status, enabled, writer_runtime
FROM public.provider_registry
ORDER BY provider;

SELECT count(*) AS enabled_policy_count
FROM public.source_policy
WHERE enabled;

SELECT count(*) AS enabled_source_count
FROM public.career_sources
WHERE enabled;

SELECT *
FROM public.career_source_activation_status
WHERE enabled OR production_eligible
ORDER BY provider, source_key;
```

For the G008 census deployment, both enabled counts must be `0` and the final
query must return no rows.

Inspect run evidence without raw payloads:

```sql
SELECT
  id,
  provider,
  career_source_id,
  run_mode,
  status,
  completeness_state,
  requests_count,
  response_bytes,
  duration_ms,
  request_cost_minor,
  request_cost_currency,
  requested_at,
  finished_at
FROM public.worker_runs
ORDER BY requested_at DESC
LIMIT 100;
```

Absence reconciliation requires a succeeded `complete_snapshot` whose
`complete_scope_token` exactly matches its immutable `planned_scope_token`.
Incomplete, capped, blocked, failed, or tokenless runs cannot prove absence.

## Policy and privacy handling

- Store evidence/agreement references, never credentials or agreement bodies.
- Keep logs and residual labels bounded and redacted.
- Do not store CV text, target role/location, raw search terms, application
  payloads, tokens, cookies, or unredacted provider errors.
- `cohort_dimensions` allows only `country_code`, `subscription_tier`,
  `experience_band`, `activity_band`, and `inventory_segment`, with primitive
  values of at most 64 characters.
- `hashed_user_id` is pseudonymous operational data, not anonymized data; retain
  it only for the approved evidence window.
- Policy expiry is evaluated at activation and in the activation-status view.
  An expired policy cannot authorize a new source run.

## Blocked-to-live transition

G008 ends with sources disabled. A later production activation must:

1. characterize the provider against versioned fixtures;
2. record a current approved production policy;
3. prove the provider has exactly one canonical writer;
4. add a least-privilege source registration/enablement RPC;
5. run shadow/dry-run ingestion with zero `jobs` mutations;
6. exercise provider/country rollback;
7. enable one bounded source canary and monitor inventory/fulfillment gates.

Tenant/country switches may narrow scheduling only after the whole provider
belongs to one runtime. They must never split canonical writes between Python
and TypeScript.

## Rollback

The down migration is destructive and is only for an isolated test database:

```bash
psql "$TEST_JOBS_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/db/migrations/20260720000400_job_supply_observability.down.sql
```

In production, leave additive metadata in place, keep sources disabled, stop
census/schedules, and preserve run evidence for diagnosis.
