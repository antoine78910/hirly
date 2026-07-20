# Bun Worker Runtime Operations

This runbook covers the isolated `apps/worker` service. It does not authorize a
production deployment, database migration, provider activation, live transport,
or routing change. Those actions require a separate approval checkpoint.

## Safety model

- Delivery is at least once. Every externally visible effect must be idempotent.
- Postgres is authoritative for runs, tasks, leases, attempts, and schedules.
- Only the current lease token, claim generation, owner, and unexpired lease may
  heartbeat, finish, or write canonical jobs.
- Provider work remains disabled unless authorization is reviewed, the declared
  writer is `typescript`, and an operator explicitly enables it.
- The Python service and `backend/railway.toml` remain unchanged. Never run the
  Python and TypeScript writers for the same provider concurrently.

## Required configuration

Configure secrets in the deployment platform, not in source, image layers,
command arguments, or logs.

| Variable | Requirement |
| --- | --- |
| `NODE_ENV` | Set to `production` in Railway. |
| `JOBS_DATABASE_URL` | Dedicated least-privilege worker credential; production URLs require TLS. |
| `PORT` | Injected by Railway; the HTTP server must bind it. |
| `WORKER_CONTROL_ENABLED` | Keep `false` until protected control-plane use is required. |
| `WORKER_CONTROL_TOKEN` | At least 32 characters; required when control is enabled. |
| `WORKER_CONCURRENCY` | Start conservatively and increase only after queue and provider limits are observed. |
| `WORKER_LEASE_SECONDS` | Must exceed the heartbeat interval and expected shutdown handoff time. |
| `WORKER_HEARTBEAT_SECONDS` | Must be shorter than the lease duration. |
| `WORKER_SHUTDOWN_MS` | Must be shorter than Railway's configured drain window. |
| `WORKER_INSTANCE_ID` | Use a non-sensitive, per-replica identifier. |

Do not print parsed configuration or validation input. Configuration errors may
name invalid variables but must not include their values.

## Health semantics

- `GET /health/live` proves that the process event loop can serve a request. It
  does not query dependencies and returns no environment or secret detail.
- `GET /health/ready` returns success only after the consumer is initialized
  and Postgres passes the bounded readiness probe.
- Readiness becomes unsuccessful before graceful drain begins and after the
  documented database-failure grace period.
- A ready response does not mean that any provider is enabled.

Railway should use `/health/ready` as the deployment healthcheck. Railway
deployment healthchecks are not continuous monitoring; use structured logs and
operational queries after deployment.

## Protected HTTP control plane

- If `WORKER_CONTROL_TOKEN` is absent, every control route fails closed.
- Compare a fixed-length digest of the presented bearer token with the configured
  token digest using a timing-safe comparison.
- Reject missing, malformed, or invalid authorization generically.
- Enforce request body and request-time limits before parsing or enqueueing.
- Accept only the shared allowlisted run schema. Never accept executable
  commands, SQL, arbitrary provider payloads, or transport-specific options.
- Protect both run creation and run status. Return the redacted run view only;
  never return task payloads, credentials, evidence bodies, or raw errors.
- Log only a non-reversible actor/token fingerprint, never the token.

## Scheduler invariants

The database schedule row is the source of truth. A scheduler iteration must:

1. Select persisted due schedules using database time.
2. Treat the persisted `next_due_at` as the occurrence identity.
3. Calculate the cron successor in the persisted IANA timezone.
4. Call the transactional due-enqueue operation, which locks the schedule row,
   inserts or reuses the occurrence, and advances `next_due_at`.
5. Limit missed occurrences to the schedule's configured catch-up bound.

Do not derive `scheduled_for` from process startup time or `Date.now()`. On
restart, reconstruct due work from Postgres. A disable racing an enqueue must
serialize on the same schedule row; after disable commits, no later occurrence
may be inserted.

## Graceful shutdown

On `SIGTERM` or `SIGINT`, perform this order:

1. Mark readiness unsuccessful.
2. Reject new control-plane triggers.
3. Stop scheduler polling and new queue claims.
4. Continue heartbeats for already claimed work while it drains.
5. Allow active handlers to finish within the configured drain deadline.
6. Treat a rejected heartbeat or finish operation as `lease_lost`; never report
   that attempt as successful.
7. At the deadline, abort cancellable transport work and leave ownership to the
   lease/retry state machine. Do not forge a successful or cancelled transition
   after lease loss.
8. Stop the HTTP server and close the database pool last.

The Docker command must use exec form so Bun receives Railway's termination
signal directly. A forced process exit is not evidence that an in-flight network
request was cancelled; the persisted lease and attempt history remain the
diagnostic record.

## Deployment checklist

Before any external action:

- `bun install --frozen-lockfile`
- `bun run lint`
- `bun run typecheck`
- `bun test`
- `bun run build`
- build the worker Docker image from the repository root
- verify the image runs as a non-root user and contains no `.env` or credentials
- configure Railway `drainingSeconds` above `WORKER_SHUTDOWN_MS` so SIGKILL is
  not the normal drain path
- run migration, lease-race, restart, scheduler, HTTP authorization, and shutdown
  tests against disposable Postgres
- confirm `backend/railway.toml`, live CRA routing, auth, and billing are unchanged

First canary:

1. Create a separate Railway service using `apps/worker/Dockerfile`.
2. Apply the additive migration only after explicit approval.
3. Deploy one replica with all providers and schedules disabled.
4. Verify liveness, readiness, structured redaction, and database connectivity.
5. Prove restart recovery and competing claims before adding replicas.
6. Enable only a separately authorized provider/country canary.
7. Observe queue age, retries, stale leases, inventory quality, and fulfillment
   gates before increasing concurrency or frequency.

## Rollback

1. Disable the affected schedule and provider.
2. Stop new claims and allow active leases to finish or expire visibly.
3. Roll back the worker deployment independently.
4. Keep additive queue tables for diagnosis unless cleanup is explicitly
   approved.
5. Never redirect canonical writes to Python while a TypeScript writer can still
   claim or complete work.

Stop immediately on authorization uncertainty, duplicate ownership or writes,
unbounded queue age, stale-lease growth, inventory-quality regression,
fulfillment regression, secret exposure, or any existing-product routing,
retention, churn, refund, or security regression.

## Log and diagnostic hygiene

Structured events may include run/task IDs, task type, provider, attempt counts,
durations, counts, stable reason codes, and a non-sensitive instance ID. They
must not include:

- database URLs, bearer tokens, cookies, passwords, or authorization evidence;
- raw task/provider payloads or fetched documents;
- email addresses, phone numbers, or applicant details;
- unrestricted exception objects whose message or stack may contain inputs.

Use stable error codes in operator views. Keep detailed redacted diagnostics in
server-side logs only.
