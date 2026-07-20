# Job supply integration and release readiness

This runbook closes the repository-level integration requirements for the
French supply and ATS work. It is not an instruction to deploy or enable a
source. External production actions require a separate operator approval.

## Verification command

Repository-only verification:

```bash
bun run verify:job-supply-release
```

Full local verification, including the legacy frontend and worker image:

```bash
bun run verify:job-supply-release -- --profile full
```

Add the complete disposable-Postgres matrix:

```bash
G015_TEST_DATABASE_URL='postgresql://user:password@localhost/hirly_release_test' \
  bun run verify:job-supply-release -- \
    --profile full \
    --allow-disposable-database \
    --expected-head "$(git rev-parse HEAD)" \
    --output ".omx/verification/job-supply-release-$(git rev-parse --short HEAD).json"
```

The command refuses database verification unless both conditions hold: the URL targets
loopback with a database name containing `test` or `disposable`, and the operator passes
`--allow-disposable-database` (or sets `G015_ALLOW_DISPOSABLE_DATABASE=true`).
The supplied URL is a connection template, not a suite target. The verifier derives seven
unique run-scoped names, proves each database did not exist, creates each from `template0`,
proves it is empty, assigns exactly one database to each PostgreSQL suite, and drops all
seven in a final cleanup path even after a failed check. Existing databases are never
reused. The PostgreSQL suites are destructive and must never target staging or production.

The command also requires a clean working tree, records the exact HEAD plus a content
digest before and after verification, and fails if repository content changes during the
run. Use `--expected-head` to bind the run to the reviewed 40-character commit SHA. Output
must be a new, non-symlinked path below `.omx/verification` and is written via an atomic
rename. Stack-policy validation covers newly added production Python modules over
`G015_BASE_SHA..HEAD`, or the merge-base with `origin/main` when that variable is
unset. The manifest records SHA-256 hashes for the verifier, lockfiles, Docker inputs,
deployment configuration, every migration, and every invoked tool binary. Missing database,
Docker, credentials, or external deployment authority is recorded as typed
`blockedExternal` entries with `readinessStatus: BLOCKED_EXTERNAL`; it must never be
represented as a passing live check.

The full profile builds a unique Docker tag, records the image ID, layer digests and a
digest of the inspected runtime configuration, then removes the tag in the verifier cleanup
path. It also runs a critical-severity production-dependency audit, the legacy
frontend test suite and the ingestion/feed-critical Python
compatibility suite from the repository `.venv`; install `backend/requirements.txt` into
that environment before running the command. Existing CRA lint warnings and
non-critical legacy toolchain advisories remain visible and must stay in the
dependency-remediation backlog; the release gate rejects critical advisories.
The production build does not suppress its warning output. After the seven
PostgreSQL suites, the verifier queries the migrated G014 database
and requires zero enabled providers, TypeScript writers, worker/Python schedules, career
source transports, production policies, and production-eligible policy evidence. Static
migration inspection separately rejects top-level provider, source, policy, evidence, or
schedule activation statements.

## Topology preflight

1. Determine whether jobs are unsplit or use the optional inventory database.
2. Locate the physical database containing `public.jobs`.
3. Confirm `JOBS_DATABASE_URL` points directly to that same database with TLS in
   production. A PostgREST URL is not a worker database URL.
4. Apply every worker/source migration to that inventory database. Do not apply
   inventory metadata to the auth/billing database when jobs are split.
5. Confirm the runtime role is least privilege and the operator credential is
   separate.
6. Record counts/checksums for canonical jobs, application/fulfillment queues,
   enabled schedules, provider ownership and enabled sources before migration or
   trial.

There is no cross-database transaction between auth/profile state and a split
jobs database. Cohort evaluation is read-only and must freeze the profile/cohort
digest used by a trial scorecard.

## Ordered migration application

Apply in this order with `psql -v ON_ERROR_STOP=1`:

1. `20260720000100_typescript_worker_foundation.sql`
2. `20260720000200_bun_worker_runtime.sql`
3. `20260720000300_job_ingestion_run_ledger.sql`
4. `20260720000400_job_supply_observability.sql`
5. `20260720000500_job_dedup_linkage.sql`
6. `20260720000600_typescript_ingestion_source_boundary.sql`
7. `20260720000700_provider_ownership_epochs.sql`
8. `20260720000800_ats_tenant_source_registration.sql`
9. `20260720000900_ats_registration_activation_hardening.sql`
10. `20260720001000_open_source_policy_evidence.sql`
11. `20260720001100_source_trial_foundation.sql`

The following same-day migrations belong to the **primary application
database**, not the split inventory database. They are documented here so a
release operator does not accidentally treat the repository-wide timestamp
prefix as an inventory placement rule:

1. `20260720001100_auth_session_lookup.sql`
2. `20260720001200_onboarding_profile_patch.sql`
3. `20260720001300_application_tracker_contracts.sql`
4. `20260720001350_notification_mark_all.sql`
5. `20260720001400_auto_apply_backfill.sql`
6. `20260720001500_gmail_outcome_batch.sql`
7. `20260720001600_admin_bounded_contracts.sql`
8. `20260720001700_service_only_rls.sql`

Apply these only through the
[application-database release process](application-database-migration-runbook.md)
after its compatibility, bounded-backfill and rollback gates. They are not prerequisites for the
evidence-only source trial and must never be applied to a split inventory
database merely to satisfy filename ordering.

Use a single transaction only when the target environment and migration have
been proven compatible with it. Otherwise stop on the first error and inspect
the additive state; do not continue out of order.

### Unsplit

Apply the list to the primary database containing `public.jobs`.

### Split

Bootstrap `backend/db/jobs_inventory_schema.sql` on the inventory database,
then apply the ordered list there using `JOBS_DATABASE_URL`. Keep auth, billing,
profiles and user application state on the primary application database. In
this topology, “the ordered list” means the eleven inventory migrations above,
not the separately listed application-database migrations.

## Deployment configuration validation

Repository checks must prove:

- the legacy frontend installs from `package-lock.json` with
  `npm ci --legacy-peer-deps`;
- `apps/worker/Dockerfile` builds from the repository root, uses an exec-form
  command, runs as `USER bun`, and does not copy `.env` files;
- `apps/worker/railway.toml` uses `/health/ready` and a drain window longer than
  `WORKER_SHUTDOWN_MS`;
- the root and frontend Vercel configurations retain the existing CRA and
  FastAPI routing and contain no worker route;
- `backend/railway.toml` remains the current FastAPI deployment configuration;
- no provider/source/schedule is enabled by a migration;
- `WORKER_CONTROL_ENABLED=false` unless a separately protected operator control
  plane is approved.

An actual Vercel preview, Railway service creation, Supabase migration or
provider request is external production/staging work and is not performed by
this repository verification command.

## Disabled deployment sequence

After explicit external approval:

1. Complete repository, frontend, Docker and disposable-Postgres verification.
2. Apply additive migrations with all providers, sources and schedules disabled.
3. Deploy one worker replica with control disabled and no live source secrets.
4. Verify liveness, readiness, redacted logs and graceful shutdown.
5. Run fixture and preview-only source checks.
6. Run an approved evidence-only shadow trial; verify canonical/application
   checksums are unchanged.
7. Review the source scorecard and legal evidence.
8. Only then authorize a bounded provider/country canary with one canonical
   writer.

## Operational rollback

Operational rollback is the production-safe default:

1. Disable the source/provider schedule and transport.
2. Stop new claims and let current leases finish or expire.
3. Prove the current writer cannot claim or write.
4. For a writer transfer, move the provider through
   `writer_runtime=none`; never run Python and TypeScript simultaneously.
5. Roll back the worker image independently.
6. Retain additive run, snapshot, occurrence, trial and attempt evidence for
   diagnosis according to source retention policy.

## Destructive rollback

Every `*.down.sql` file is for isolated test databases unless a separate,
data-reviewed production rollback is approved. If destructive rollback is
explicitly approved, execute down migrations in **reverse order**, stopping on
the first failure. Export required evidence first. Never drop source or trial
tables merely to hide an operational incident.

## Source activation gate

Use `docs/operations/job-source-readiness-matrix.md` and require:

- current written policy covering the exact access, commercial, redisplay and
  retention use;
- measured incremental fresh, unique, relevant, actionable jobs for paid users;
- stable identity and complete update/removal behavior;
- canonical/direct application route quality;
- source health, cost and concentration evidence;
- independent kill switch and exercised rollback;
- one authoritative canonical writer.

## Evidence semantics

Repository evidence can prove code defaults, migration grants, tests,
configuration files and local checksums. It cannot prove the current Railway,
Vercel, Supabase or vendor account state without authorized external access.
The final manifest must say “not performed” for those actions rather than claim
that remote state was inspected.
