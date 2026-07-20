# TypeScript ingestion source boundary

## Status and safety envelope

G009 is a `TS_NEW` additive foundation. It does not ship a live source
transport, enable a source or schedule, transfer provider ownership, or replace
the existing `jobs` read model.

The following invariants must remain true after migration:

- `provider_registry.writer_runtime` is the only provider writer authority.
- New source, transport, incremental, and backfill flags default to `false`.
- Existing `jobs.job_id` values and FastAPI/frontend reads remain valid.
- Raw payloads are immutable and are not readable by the inventory reader role.
- Occurrence provenance is bound to its source identity, raw snapshot, and run.
- Source execution is denied unless provider ownership, policy, country, mode,
  and both provider/source country kill switches pass.
- No incomplete or failed run is evidence for expiry or removal.

There is no production activation procedure in this runbook. A future transport
must add its own characterized fixtures, scoped writer RPC, rollout switch,
observability, and provider-level rollback before activation.

## Objects

Migration `20260720000600_typescript_ingestion_source_boundary.sql` adds:

- disabled source transport and mode flags;
- provider/source country kill switches;
- immutable `raw_job_snapshots`;
- `job_occurrences`;
- stable `canonical_job_groups`, membership, and immutable events;
- additive lifecycle and grouping columns on `jobs`;
- a sanitized raw-snapshot metadata view;
- a scoped source-runnability function.

The migration must not grant direct insert, update, or delete access to the new
evidence or grouping tables. Until a scoped writer RPC exists, they are schema
boundaries only.

## Preflight

1. Confirm the target is an isolated PostgreSQL database.
2. Apply the jobs schema and migrations `00100` through `00500`.
3. Confirm no provider or source is enabled:

```sql
SELECT count(*) FROM provider_registry WHERE enabled;
SELECT count(*) FROM career_sources
WHERE enabled OR transport_enabled OR incremental_enabled OR backfill_enabled;
```

Both counts must be zero. Do not change them for G009 verification.

## Isolated migration verification

Apply the migration with fail-fast settings:

```bash
psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -f backend/db/migrations/20260720000600_typescript_ingestion_source_boundary.sql
```

Verify disabled defaults and unchanged ownership:

```sql
SELECT provider, enabled, writer_runtime
FROM provider_registry
ORDER BY provider;

SELECT provider, source_key, enabled, transport_enabled,
       incremental_enabled, backfill_enabled
FROM career_sources
ORDER BY provider, source_key;
```

Verify privileges with isolated roles:

```sql
SET ROLE hirly_inventory_reader;
SELECT count(*) FROM raw_job_snapshots; -- must fail
RESET ROLE;

SET ROLE hirly_inventory_worker;
SELECT worker_private.career_source_runnable(
  '00000000-0000-0000-0000-000000000000', 'FR', 'incremental'
); -- must return false
RESET ROLE;
```

PostgreSQL tests must additionally prove:

- the same payload can be recorded in separate runs without losing run
  provenance;
- replay within one run is idempotent;
- cross-source or cross-external-ID snapshot references fail;
- occurrence content hash and canonical job identity cannot drift;
- update/delete of raw snapshots and group events fail;
- empty country scopes fail closed;
- malformed or non-uppercase kill-switch keys fail;
- source and provider kill switches independently return `false`;
- blocked, expired, non-redisplay, or non-retention policy returns `false`;
- reader/anonymous/authenticated roles cannot read raw payloads or execute
  privileged mutation paths.

## Rollback verification

Rollback is an isolated-database proof, not a production procedure:

```bash
psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -f backend/db/migrations/20260720000600_typescript_ingestion_source_boundary.down.sql
```

Confirm all G009 tables, views, functions, constraints, and additive `jobs`
columns are removed, then reapply the migration once. A production rollback
must preserve captured evidence and legacy references; do not run the down
migration against live data without a separately reviewed data-retention plan.

## Stop conditions

Stop and do not integrate or activate when any of the following is true:

- a provider/source/mode becomes enabled by migration;
- writer ownership changes;
- raw payloads become reader-visible;
- a security-definer function is owned by an assumable runtime/operator role;
- country or policy checks differ between TypeScript and PostgreSQL;
- a run/snapshot/occurrence identity can be cross-linked;
- targeted tests, typecheck, lint, PostgreSQL up/down, or privilege checks fail.
