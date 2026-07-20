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

The immutable aggregate is
`artifacts/job-ingestion/g018-route-readiness-baseline-2026-07-20.json`.

| Measure | Count | Share of fresh French inventory |
| --- | ---: | ---: |
| Fresh layered French jobs | 70,492 | 100% |
| Actionable, including manual routes | 68,991 | 97.87% |
| Static known-ATS candidates | 17,686 | 25.09% |
| Strict current-runtime candidates | 1,923 | 2.73% |

The prior static interpretation would overclaim 15,763 jobs, or 89.13% of the
known-ATS candidate set, as auto-applicable. The largest strict runtime source
is direct SmartRecruiters inventory with 962 jobs. France Travail occurrences
contribute 801 strict candidates, or 41.65% of the strict set, mostly through
Taleez.

These are route-capability candidates, not verified submissions. G018 still
requires bounded no-submit route inspection and paid-user coverage evidence.

## Failure census

Every non-runtime-ready job is assigned to exactly one ordered bucket:

| Reason | Count |
| --- | ---: |
| Known ATS without current runtime driver | 58,549 |
| Unknown ATS | 5,739 |
| Aggregator or discovery route | 2,780 |
| Expired or unavailable | 1,346 |
| Missing URL | 155 |

The remaining defined buckets were zero in this aggregate because the earlier
ordered classification captured them in a more fundamental blocker. A bounded
live no-submit inspection may refine those buckets without mutating attempts or
submitting an application.

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

## Remaining external evidence

The baseline is intentionally `BLOCKED_EXTERNAL` because no fresh paid-user
strict-auto coverage run exists. Completion requires:

- P10/P50/P90 strict runtime-ready jobs per paid user;
- strict-auto feed-exhaustion rate;
- affected paid users by provider;
- bounded no-submit inspection outcomes;
- preferred-occurrence uplift;
- France Travail and top-provider concentration gates.

Run `docs/operations/sql/french-route-readiness-census.sql` with explicit fixed
timestamps for a fresh aggregate, then use:

```bash
bun run --cwd apps/job-ingestion-audit measure:route-readiness -- \
  --input artifacts/job-ingestion/g018-route-readiness-input.json \
  --output artifacts/job-ingestion/g018-route-readiness.json
```

The report builder refuses sample, blocked, unreconciled or non-monotonic
evidence.
