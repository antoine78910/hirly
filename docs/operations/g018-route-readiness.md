# G018 French application-route readiness

Classification: `TS_NEW` with a bounded `PY_FIX` bridge for the existing
FastAPI runtime.

This evidence distinguishes a recognizable ATS URL from an application route
that Hirly's current runtime can actually inspect and queue. It does not submit
applications, activate a source, transfer writer ownership or change canonical
job preferences.

## Authoritative capability catalogue

`packages/ingestion/src/application-capabilities.json` is the reviewed source
of truth for:

- URL detection;
- inventory connector availability;
- tenant extraction;
- registered application driver;
- queue permission;
- verified no-submit behavior.

Strict auto-application readiness requires all three runtime gates:
`driverRegistered`, `queuePermitted` and `noSubmitVerified`. Detection alone is
never sufficient. The current strict set is Greenhouse, SmartRecruiters,
Taleez, Teamtailor and Jobaffinity. Lever and Ashby remain detectable inventory
sources but are not counted as runtime-ready because no application driver is
registered.

The Python backend loads the reviewed repository catalogue when available and
an exact bundled snapshot when Railway runs with `backend/` as the service
root. Tests require both JSON files to remain identical and reconcile the
strict set against the actual driver registry and default queue allowlist.

## Read-only production baseline

The aggregate-only read performed on 2026-07-20 used:

- generated time: `2026-07-20T18:33:01.850467Z`;
- freshness cutoff: `2026-06-20T18:33:01.850467Z`;
- query version: `g018-route-readiness-v1`;
- layered identity: non-empty fingerprint, otherwise stable `job_id`;
- country: `FR`;
- no user, job, URL or profile rows in the output.

The refreshed immutable aggregate is
`artifacts/job-ingestion/g018-route-readiness-2026-07-20.json`.

| Measure | Count | Share of fresh French inventory |
| --- | ---: | ---: |
| Fresh layered French jobs | 70,492 | 100% |
| Actionable, including manual routes | 68,988 | 97.87% |
| Static known-ATS candidates | 17,686 | 25.09% |
| Strict current-runtime candidates | 1,923 | 2.73% |

The prior static interpretation would overclaim 15,763 jobs, or 89.13% of the
known-ATS candidate set, as auto-applicable. The largest strict runtime source
is direct SmartRecruiters inventory with 962 jobs. France Travail occurrences
contribute 801 strict candidates, or 41.65% of the strict set, mostly through
Taleez.

These are route-capability candidates, not verified submissions. The bounded
no-submit inspector below validates driver inspection without making an
application attempt or submitting an application.

## Failure census

Every non-runtime-ready job is assigned to exactly one ordered bucket:

| Reason | Count |
| --- | ---: |
| Known ATS without current runtime driver | 58,549 |
| Unknown ATS | 5,739 |
| Aggregator or discovery route | 2,777 |
| Expired or unavailable | 1,349 |
| Missing URL | 155 |

The remaining defined buckets were zero in this aggregate because the earlier
ordered classification captured them in a more fundamental blocker. A bounded
authorized no-submit inspection may refine those buckets without mutating
attempts or submitting an application.

## Bounded no-submit inspection

`backend/tests/run_no_submit_route_inspection.py` is an operator harness over
the existing Python driver registry. It accepts at most 100 jobs, permits four
concurrent inspections, enforces a 20-second per-route timeout, requires HTTPS
provider-host alignment and rejects DNS answers that are not globally routable.
It imports neither the executor, attempt metrics nor queue and calls only
`inspect_application`.

The output contains aggregate provider/outcome/failure counts and a digest. It
never emits input URLs, job IDs, application IDs, profile data or exception
details. Its safeguards explicitly report zero application submissions,
attempt writes, canonical writes, activation changes and writer transfers.

The committed
`artifacts/job-ingestion/g018-no-submit-inspection-contract-2026-07-20.json`
is fixture-contract evidence against the real registered JobAffinity driver; it
is not represented as a live inventory census. For an authorized bounded live
sample, prepare a local JSON array of jobs and run:

```bash
PYTHONPATH=backend:backend/tests .venv/bin/python \
  backend/tests/run_no_submit_route_inspection.py \
  --input /tmp/authorized-route-sample.json \
  --output /tmp/authorized-route-aggregate.json \
  --allow-network
```

Do not use `execute_application(..., dry_run=True)` for this audit: that path
claims and persists an application attempt before inspection.

### Recruitee and Nicoka manual-route boundary

Recruitee and Nicoka are inventory connectors only. They have no registered
application driver, queue permission or verified no-submit submission path, so
their maximum safe route state is `inventory_manual`; environment configuration
and fixture evidence cannot widen that state. Greenhouse is limited to the
reviewed `hosted_candidate_form` transport. Public-candidate APIs and
credentialed employer APIs are denied even when other route-policy fields
match.

The committed inspection harness implements tenant/posting-bound Recruitee and
Nicoka URL validation, fixture-only form classification, aggregate
`routeStates`, `formClasses`, and `corpusCoverage`, plus the 50-form-per-provider
thresholds. These are tooling capabilities only. Committed fixtures and live
runs do not constitute production authority, permission to register a driver,
or permission to enable automation; an authorized evidence run must still meet
the acceptance thresholds below and prove no queue, registry, capability or
submission mutation.

## Dry-run preferred occurrence

`buildOccurrencePreferenceDryRun` ranks active occurrences without writing
`canonical_job_groups.preferred_job_id`:

1. verified runtime-supported ATS;
2. other direct ATS;
3. direct company route;
4. official public/manual route;
5. account-required route;
6. discovery-only or unknown route.

Direct-employer authority, confidence, verification recency and a stable
occurrence key break ties. The report emits aggregate counts and a digest only;
it never emits source URLs, job IDs or group IDs.

The dry-run also reports current versus proposed verified-runtime and direct
selection counts plus their uplift. Current selections are counted only when
the selected occurrence is still active and present in the evaluated group;
the command never writes `preferred_job_id`.

## Source-diversification gate

`buildSourceDiversificationGate` combines only aggregate, digest-bound route
readiness, G016 net-new and frozen paid-cohort evidence. It returns `GO` or
`NO_GO` against operator-supplied release thresholds for:

- incremental runtime-ready inventory;
- France Travail runtime-ready share;
- top-provider concentration;
- feed-exhaustion rate;
- paid-user P10 availability and non-regression across P10/P50/P90.

Proposed source rows must be unique, non-France-Travail aggregates and must
reconcile exactly to projected runtime-ready uplift. The evaluator refuses
sample or `BLOCKED_EXTERNAL` inputs and emits no user, job, URL, tenant or
application records. It cannot activate a source, submit an application or
write canonical inventory.

After the non-sample G016 and paid-cohort artifacts exist, run:

```bash
bun run --cwd apps/job-ingestion-audit measure:source-diversification -- \
  --input artifacts/job-ingestion/g018-source-diversification-input.json \
  --output artifacts/job-ingestion/g018-source-diversification.json
```

Thresholds are evidence gates, not activation instructions. A `GO` artifact
still requires the source-policy, writer-ownership, rollout and rollback gates
for each proposed source.

The production schema audit found no `job_occurrences`,
`canonical_job_groups`, or `canonical_job_group_members` relations. The legacy
`jobs.fingerprint` field is not an occurrence ledger and must not be used to
fabricate preferred-direct-occurrence uplift. The committed typed evidence is
`artifacts/job-ingestion/g018-occurrence-preference-blocked-2026-07-20.json`.
It is explicitly non-scoreable, reports a `null` uplift, and records the exact
unlock condition: apply an approved backward-compatible occurrence schema,
populate it through the single-writer ingestion boundary, and then run the
aggregate read-only preference census.

## Remaining external evidence

The refreshed non-sample artifact evaluates 74 paid users: P10/P50/P90 are
0/38/133, eight users are exhausted (10.810811%), France Travail supplies
41.653666% of strict runtime-ready inventory and the top provider supplies
50.026001%. These values reconcile the current paid-cohort and concentration
baseline without user identifiers.

Projected source-diversification remains unscoreable until G016 supplies an
authorized non-sample net-new measurement, affected-user contribution counts,
and a completed repeated-sync observation window. Preferred-occurrence uplift
also remains structurally unknown until the occurrence schema is deployed and
populated. Neither blocker authorizes a migration, source activation, writer
transfer or application submission.

Run `docs/operations/sql/french-route-readiness-census.sql` with explicit fixed
timestamps for a fresh aggregate, then use:

```bash
bun run --cwd apps/job-ingestion-audit measure:route-readiness -- \
  --input artifacts/job-ingestion/g018-route-readiness-input.json \
  --output artifacts/job-ingestion/g018-route-readiness.json
```

The report builder refuses sample, blocked, unreconciled or non-monotonic
evidence.
