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

## Provider core readiness and activation

The Apec, HelloWork, Welcome to the Jungle (`wttj`), and Indeed modules are
fixture-backed provider cores. Core readiness does not authorize live extraction
or activation.

| Provider | Initial authorization state | Live activation prerequisite |
| --- | --- | --- |
| Apec | `unverified` | Record an approved API, feed, license, or written permission. |
| HelloWork | `unverified` | Record an approved API, feed, license, or written permission. |
| WTTJ | `blocked` | Obtain written permission or an approved feed/API. |
| Indeed | `blocked` | Obtain approved partner/API access for inventory search. |

Until those prerequisites are recorded, only sanitized approved fixtures may
cross the transport boundary. Do not add guessed endpoints, credentials,
browser automation, login/CAPTCHA bypasses, or scraping fallbacks. A blocked or
unverified transport must fail before any network call.

The implementation boundaries are:

- `packages/ingestion` for provider-neutral normalization, validation, identity,
  deduplication, rate control, metrics, and repository orchestration;
- `apps/worker/src/providers/` for the four provider cores and disabled
  transports;
- `packages/contracts` for the shared runtime schemas;
- `packages/db` for the lease- and provider-fenced canonical write.

Provider modules own only raw schemas, access/pagination boundaries, rate
policy, and provider-to-canonical mapping. They must not import a database
client or write canonical rows. All accepted records use the shared pipeline:

```text
fetch -> normalize raw -> normalize canonical -> validate applyability
      -> assign identity/fingerprint -> deduplicate -> canonical batch upsert
```

The deterministic identity is
`job_ + sha1(provider + ":" + external_id).slice(0, 16)`. A retry for the same
`(provider, external_id)` must update the same row. An existing row whose
`job_id` does not match that identity is an integrity failure and must not be
overwritten.

### Core-readiness evidence

Before describing a provider core as ready, retain evidence for:

- approved, sanitized fixture provenance under `tests/fixtures/g004/` and
  raw-schema validation;
- pagination/cursor termination, duplicate-page handling, and stable failures;
- normalized identity, country/location, apply URL, ATS, validation tier, and
  manual/automatic fulfillment readiness;
- complete sanitized source data in the canonical `data` document;
- provider-specific request rate and concurrency limits;
- fetched, accepted, rejected, deduplicated, and upserted counts plus fetch,
  normalization, validation, database, and total durations;
- an unauthorized test proving zero network calls and zero canonical writes;
- an idempotent rerun proving one canonical row and the same stable identity.

Core-readiness tests are fixture-only. A live contract test is a separate,
opt-in gate and must remain skipped unless approved access and test credentials
are present.

### Activation sequence

Activation requires both independent gates:

1. The code-level transport has been implemented from an approved access method
   and remains disabled by default.
2. The persisted provider registry is `authorized`, contains a reviewed evidence
   reference, declares `writer_runtime=typescript`, and is explicitly enabled.

Then, and only after an operator approval checkpoint:

1. Confirm no Python writer or schedule owns the provider/country.
2. Run the provider fixture suite and a read-only/shadow comparison.
3. Configure the documented rate and concurrency limits.
4. Perform one bounded live dry run without canonical writes.
5. Enable one provider/country canary and verify canonical read-back.
6. Rerun the same bounded input to prove idempotence.
7. Observe inventory quality, freshness, queue age, fulfillment readiness, and
   duplicate protection before enabling a persisted schedule.

Downgrading authorization, changing writer ownership, or disabling a provider
must fence fetch and canonical write on the same provider-registry boundary.
Fetched results may not write after a downgrade commits.

### France Travail Python-owner precondition

Apply `20260720000700_provider_ownership_epochs.sql` before deploying the
claim-aware Python France Travail callers. On a fresh schema it creates only a
disabled, unverified `france_travail` registry row with
`writer_runtime=python`, `ownership_epoch=0`, and `claims_required=false`.
`ON CONFLICT DO NOTHING` preserves any existing operator-managed owner.

This is deliberately staged:

1. Confirm the registry row is Python-owned before deploying the Python claim
   callers; if an existing row says `none` or `typescript`, stop rather than
   rewriting it during migration.
2. Verify every France Travail scheduler, fallback, harvest, and canonical
   write uses the Python claim/heartbeat/guarded-write/finish boundary.
3. Keep `lifecycle_claims_ready=false` until validation, soft-expiry, purge,
   and other lifecycle mutations have scoped claim-aware RPC coverage. The
   database rejects ownership transitions and claim enforcement while this
   gate is false.
4. Only after that separate lifecycle migration, call
   `worker_private.enable_provider_claim_enforcement('france_travail')`.
5. Keep TypeScript provider/source/mode flags disabled until a separate
   transition through `writer_runtime=none` is approved and drained.

Other Python providers remain non-claim-aware and unchanged. Do not enable
claim enforcement globally or for a provider whose writers have not been
characterized and migrated.

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
3. Verify the TypeScript writer can no longer claim or complete provider work.
4. Restore the previous writer only after that fence is proven.
5. Roll back the worker deployment independently.
6. Keep additive queue tables for diagnosis unless cleanup is explicitly
   approved.
7. Never redirect canonical writes to Python while a TypeScript writer can still
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
