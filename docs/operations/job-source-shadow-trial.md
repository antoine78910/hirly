# Evidence-only job source shadow trial

This runbook evaluates whether an approved source adds fresh, unique, relevant,
actionable inventory for paid users. It does not enable a production source,
write canonical jobs, enqueue applications, or transfer provider ownership.

Classification: `TS_NEW`.

## Supported trial surfaces

| Provider | Trial transport | Production transport | Notes |
| --- | --- | --- | --- |
| Greenhouse | Bounded, exact allowlisted tenant, one complete board request | Disabled | Existing Python canonical ownership is unchanged |
| Lever | Bounded, exact allowlisted tenant and global/EU host, one complete postings request | Disabled | Existing Python canonical ownership is unchanged |
| Ashby | Not ready | Disabled | URL classification exists, but the shared provider contract has no Ashby TS provider |

The transport accepts no arbitrary URL or credentials. It constructs a fixed
official HTTPS endpoint from the policy-bound tenant key, rejects redirects,
and enforces one request/page plus byte/time limits.

## Policy precondition

An operator must create a disabled `career_sources` row and a current
`source_trial_policies` row with:

- exact provider, source and tenant;
- non-production environment;
- access method equal to the source access type;
- explicit reviewer and approval reference;
- start/expiry window;
- total-run, page, candidate and byte budgets;
- a matching immutable `licence_text` or `written_permission` evidence record
  whose reviewed claim scope explicitly covers trial eligibility, provider,
  source, tenant, access method, environment, commercial use, redisplay and
  retention.

Public readability, an unauthenticated endpoint, a dataset catalogue page, or a
`requires_legal_review` qualification status is not permission and cannot
satisfy the trial gate. When the required reviewed evidence is unavailable,
persist a typed `BLOCKED_EXTERNAL` source-policy result instead of starting a
trial.

The trial policy is separate from production eligibility. It neither requires
nor changes `production_eligible`, provider authorization, canonical writer
ownership, source enablement, transport enablement or schedules.

Use a dedicated database credential mapped only to
`hirly_source_trial_worker`. Do not reuse the inventory writer or operator
credential.

## Offline preview

The preview command reads an approved recorded provider response. It performs no
network or database access:

```bash
bun run --cwd apps/worker trial -- \
  preview \
  --manifest artifacts/job-ingestion/trials/greenhouse-acme-manifest.json \
  --response artifacts/job-ingestion/trials/greenhouse-acme-response.json \
  --output artifacts/job-ingestion/trials/greenhouse-acme-preview.json
```

For Lever EU boards add `--lever-region eu`.

## Policy-gated evidence run

The live trial command calls `begin_source_trial` before the network request.
The database refuses expired, disabled, mismatched, over-budget, production,
unreviewed or non-allowlisted trials.

```bash
SOURCE_TRIAL_DATABASE_URL='postgresql://least-privilege-trial-role/...' \
bun run --cwd apps/worker trial -- \
  run \
  --manifest artifacts/job-ingestion/trials/greenhouse-acme-manifest.json \
  --output artifacts/job-ingestion/trials/greenhouse-acme-run.json
```

Only immutable trial runs, raw pages, normalized candidates and run-result
evidence can be appended. The trial role has no table DML and cannot execute
canonical job, ownership, schedule, application or fulfillment functions.
Rate-limited, budget-exhausted and failed attempts append a classified immutable
run result before the runner returns the failure. Raw-page byte counts and page
and candidate SHA-256 digests are checked in Postgres against each exact
serialized payload; the database rejects a caller claim that does not
reconcile. If the policy switches to different evidence after a run begins, all
further writes for the old run are rejected.

Each run has exactly one terminal `trial-result`. Postgres validates its complete
schema and bound run/trial identity, requires integer counters to equal the
persisted page, candidate and byte totals, and requires at least one persisted
page before accepting `completed`. The terminal write holds the same per-run
advisory lock as page and candidate writes. Once accepted, it fences every
later page, candidate or contradictory result append.

## Repeated-sync bakeoff

Run each candidate for 14 consecutive days and include at least one complete
snapshot. Preserve each run artifact and content digest. Partial, failed,
rate-limited or zero-collapse runs are evidence but cannot declare removals.

Prepare a non-sample baseline and repeated trial snapshot input with one frozen
paid-cohort digest, policy digest and control digest. Then run:

```bash
bun run --cwd apps/job-ingestion-audit trial:scorecard -- \
  --baseline artifacts/job-ingestion/trials/baseline.json \
  --snapshots artifacts/job-ingestion/trials/snapshots.json \
  > artifacts/job-ingestion/trials/scorecard.json
```

The scorecard reports:

- median and P10/P50/P90 incremental fresh, unique, relevant, actionable jobs
  per paid user;
- feed-exhaustion rate and affected paid users;
- canonical apply URL and known route rates;
- duplicate and unavailable rates;
- per-provider/tenant source concentration;
- additions/removals across complete snapshots;
- request and cost reconciliation.

It refuses sample data, `BLOCKED_EXTERNAL`, mismatched evidence digests,
incomplete snapshots, zero-volume collapse and users outside the frozen cohort.

## Multi-source aggregate uplift measurement

For G016-style multi-source comparisons, run
`docs/operations/sql/multi-source-net-new-measurement.sql` with a fixed
evidence-generation timestamp, freshness cutoff, succeeded paid-cohort coverage
run and exact trial run IDs. The query returns one aggregate JSON value only.
It refuses to report `COMPLETE` unless every distinct requested trial has its
singular reconciled `completed` terminal result and every requested source has
paid-cohort contribution evidence from the succeeded coverage run. Current
inventory uses the authoritative canonical group where present and a conservative
fingerprint/URL/ATS/occurrence fallback; trial candidates apply duplicate
precedence in this order: provider occurrence, canonical apply URL, ATS posting
identity, then fingerprint. It does not emit job IDs, external IDs,
candidate/source payloads or hashed user IDs.

Save the returned JSON object and build the immutable decision artifact:

```bash
bun run --cwd apps/job-ingestion-audit measure:net-new -- \
  --input artifacts/job-ingestion/g016-net-new-measurement-input.json \
  --output artifacts/job-ingestion/g016-net-new-measurement.json
```

The builder refuses sample or blocked evidence and requires every observed
candidate to reconcile to exactly one duplicate layer or incremental net-new.
It reports fresh/relevant/actionable paid-cohort contribution,
auto-applicable uplift and projected France Travail concentration without
including any user- or job-level rows.

## Go/no-go

Do not activate a source because the API is convenient. A production proposal
requires measured incremental cohort value, reliable identifiers and removals,
direct application quality, current commercial/redisplay/retention rights,
bounded cost, alerts, a kill switch, and an exercised whole-provider writer
rollback. Application submission remains a separate workstream.
