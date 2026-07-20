# TypeScript worker database foundation

Classification: `TS_NEW`.

The durable worker objects must be applied to the same physical Postgres
database as `public.jobs`. No operation in this document changes live data,
enables a provider, or transfers writer ownership.

## Migration files

- Apply: `backend/db/migrations/20260720000100_typescript_worker_foundation.sql`
- Test-only rollback:
  `backend/db/migrations/20260720000100_typescript_worker_foundation.down.sql`

The rollback is destructive and is only for an isolated test database. In
production, disable schedules/providers and retain additive tables for
diagnosis.

## Unsplit deployment

Use the primary direct Postgres connection, not the PostgREST URL:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/db/migrations/20260720000100_typescript_worker_foundation.sql
```

## Split inventory deployment

When `JOBS_SUPABASE_URL` or a separate inventory database is configured, apply
the existing inventory schema and worker migration to `JOBS_DATABASE_URL`:

```bash
psql "$JOBS_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/db/jobs_inventory_schema.sql
psql "$JOBS_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/db/migrations/20260720000100_typescript_worker_foundation.sql
```

The worker uses only the direct TLS-enabled `JOBS_DATABASE_URL`. It does not
assume a transaction can span the primary and inventory databases.

## Roles

- `hirly_inventory_worker`: execute-only access to enqueue, claim, heartbeat,
  fenced terminal transitions, and fenced canonical writes.
- `hirly_inventory_operator`: execute-only access to authorization, writer
  ownership, enablement, and enqueue operations.
- `hirly_inventory_reader`: select-only access to the aggregate
  `worker_capability_status` view.

Runtime roles have no direct table mutation grants. `PUBLIC`, `anon`, and
`authenticated` cannot execute private functions. Every definer function fixes
its search path.

## Fencing and authorization boundary

Claims use `FOR UPDATE SKIP LOCKED`, increment `claim_generation`, issue a new
UUID lease token, and append one attempt row in the same transaction.
Heartbeats, terminal transitions, and canonical writes require the current
task ID, lease token, generation, owner, running state, and unexpired lease.

Canonical writes and authorization changes both lock the same
`provider_registry` row. This row lock is the linearization point: either the
authorized write commits first, or the downgrade disables the provider first
and the later write fails before mutating `jobs`.

Provider rows are seeded disabled. Deployment never authorizes, enables, or
assigns TypeScript writer ownership.
