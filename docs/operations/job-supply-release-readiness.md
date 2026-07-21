# Job supply integration and release readiness

This runbook closes the repository-level integration requirements for the
French supply and ATS work. It is not an instruction to deploy or enable a
source. External production actions require a separate operator approval.

## Current release state

The operator authorized and completed the existing CRA frontend and FastAPI
backend release plus the primary-application migrations on 2026-07-20. The
authorized, read-only validation is recorded in
[`job-supply-production-validation-2026-07-20.md`](job-supply-production-validation-2026-07-20.md).
That release did **not** deploy `apps/worker`, apply the inventory/source
migrations, activate a provider/source/schedule, or transfer canonical writer
ownership.

The repository verifier below remains deliberately side-effect free. Its
`REMOTE_DEPLOYMENT_VALIDATION_NOT_PERFORMED_BY_VERIFIER` blocker means only
that the command did not inspect remote infrastructure; it is not a claim that
the legacy application has never been deployed.

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
path. It also runs a HIGH-and-CRITICAL production-dependency audit, the legacy
frontend test suite and the ingestion/feed-critical Python
compatibility suite from the repository `.venv`; install `backend/requirements.txt` into
that environment before running the command. Existing CRA lint warnings and
lower-severity legacy toolchain advisories remain visible and must stay in the
dependency-remediation backlog; the release gate rejects HIGH and CRITICAL
production dependency advisories.
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

Before any downstream digest-dependent migration, first apply the shared pgcrypto
compatibility migration to every database that will participate in that chain:

1. `20260721001950_pgcrypto_schema_compatibility.sql`

This additive migration is topology-aware:

- on a split deployment, apply it to both the inventory database and the primary
  application database before any later digest-dependent migration;
- on an unsplit deployment, apply it once to the single database.

Its down migration removes only marker-owned `public.digest` wrappers; do not
roll it back until later digest-dependent migrations have been fully rolled back.

Apply the remaining migrations in this order with `psql -v ON_ERROR_STOP=1`:

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
12. `20260720001150_source_trial_tenant_selection_binding.sql`
13. `20260720002000_sprout_source_ingestion.sql`
14. `20260720002100_sprout_canary_gate.sql`

Migration `02000` adds the Sprout source boundary only. Its provider, France
source, transport, incremental/backfill modes and schedule remain disabled;
authorization is unverified and writer ownership remains `none` until the
separate Sprout authorization, canary and rollback gates pass.

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
9. `20260720001800_admin_read_models.sql`
10. `20260720001800_posthog_warehouse_containment.sql`
11. `20260720001900_posthog_migration_ledger.sql`

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
this topology, “the ordered list” means the fourteen inventory migrations above,
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

An actual Vercel preview, Railway service creation, database migration or
provider request is external production/staging work and is not performed by
this repository verification command. Authorized remote evidence must be
captured separately, as in the dated production-validation record above.

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
Vercel, database or vendor account state without authorized external access.
The repository verifier must say that remote validation was not performed
**by the verifier** rather than making a global deployment claim. A separate
authorized attestation may record remote state, but it must identify its
observation time, commands, exact deployment IDs and remaining unverified
boundaries.

## Selected manifest, drift, and activation attestation

Every verification run writes a unique, append-only manifest named from its
collision-resistant verification ID. Operators must never replace or edit an
earlier manifest. Selection binds the immutable manifest path, the SHA-256 of
its exact bytes, and its exact 40-character release HEAD; a reserialized JSON
object is not equivalent evidence.

A selected manifest must be v4, bind `expectedHead` to `exactHead`, and contain
only passed command results. Its only permitted external blocks are:

- `REMOTE_DEPLOYMENT_VALIDATION_NOT_PERFORMED_BY_VERIFIER`, discharged with
  authorized deployment ID, deployed SHA/image digest, redacted effective
  configuration digest, health/readiness/log observations, and rollback proof;
- `SOURCE_ACTIVATION_NOT_PERFORMED`, discharged with current policy approval,
  two digest-bound shadow runs, source baselines, canary evidence, armed kill
  switches, and an exercised rollback transcript.

Each block requires exactly one durable discharge. A missing, duplicate, or
unexpected discharge fails closed. Production `/api/version` and the failed CI
workflow history currently indicate a possible second or unidentified
deployment owner. That is a hard provenance blocker until authorized operators
identify the owner, attest the exact deployed artifact and configuration, and
prove rollback. Local tooling cannot self-attest this evidence.

Drift is classified before reusing release evidence:

- `build_input` invalidates the selected manifest and code review and requires
  the full verifier, security review, code review, UltraQA, and artifact
  attestation;
- `runtime_config_outside_envelope` requires affected security review,
  UltraQA, deployment attestation, deployed smoke, and rollback proof. It also
  invalidates the selected manifest and requires the full verifier when build
  inputs changed, while code review remains valid unless code changed;
- `rollout_config_inside_envelope` preserves release review evidence but
  requires a change record, canonical configuration digest, policy/expiry
  check, deployed smoke, and rollback proof;
- `candidate_mandate` preserves release review evidence and requires claim,
  post-claim, pre-submit, and attempt evidence for that exact attempt.

The provider preflight is a pure, evidence-only evaluator. It cannot deploy,
fetch a source, write canonical state, transfer writer ownership, or submit an
application. A `PASS` is not activation: authorized operators must still
execute the approved provider/country change. Manual-inventory readiness keeps
application automation disabled. Application activation is independently
gated by submission authority, privacy basis, non-production proof, and exact
per-attempt candidate mandates.

Rollback order is exact: disable transport and schedule, stop claims and drain,
prove no writes, transition writer ownership through `writer_runtime=none`,
then assign the single authoritative writer. Applications roll back
independently; ambiguous attempts must be reconciled from durable evidence and
must never be blindly retried.

The optional `--phase0-receipt` mode captures only supplied local observations.
It recursively rejects token, password, secret, and connection-URL fields;
environment entries contain flag names and redacted states, never values. The
receipt binds canonical inputs by digest, requires owner/evidence/review expiry
and an explicit `approved` or `blocked` verdict for inventory access,
submission authority, candidate-mandate policy, and privacy basis, and labels
unobserved deployed runtime, artifact, database, or provider-baseline fields
`BLOCKED_EXTERNAL`. It does not inspect or mutate any remote system.

### Current CI and deployment-provenance blockers

The previously observed Sprout typecheck failure for missing `canaryEvidence`
and `rollbackEvidence` has been repaired in the current source and must not be
reported as the current blocker after a fresh worker typecheck. Remaining
release-evidence gaps are fail-closed:

- both repository Vercel configurations set `git.deploymentEnabled=false`, so
  Git integration cannot auto-promote around the staged workflow; because no
  deployment was performed in this lane, authorized operators must still
  confirm that the next deployment applied the repository setting;
- CI runs the verifier but does not yet publish its generated manifest as an
  immutable retained artifact, so operators cannot select a durable passing CI
  manifest from repository evidence alone;
- deployment jobs do not establish the full tuple of deployment ID, immutable
  artifact/image digest, effective redacted configuration digest, deployed
  smoke evidence, and exercised rollback proof;
- the production revision observed after a workflow that failed before deploy
  remains evidence of a possible second deployment owner/path.

Resolving these items requires separately authorized CI/deployment changes or
read-only operator evidence. This local verifier and receipt deliberately keep
production mutations and credentials disabled.
