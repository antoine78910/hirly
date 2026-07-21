# ADR — Candidate Matching Serving Branch

- Status: `DEFERRED_PENDING_STAGED_EVIDENCE`
- Decision: **No serving branch selected; no production cutover authorized**
- Goal: `G001-pr0-characterization`
- Evidence date: 2026-07-21
- Classification: `TS_NEW` oracle evidence plus existing `PY_FIX` characterization

## Context

PR0 must choose `ONLINE_FIRST` only when representative indexed retrieval meets
all API, database, availability, and product thresholds. It may authorize
`HYBRID_HOT_COHORT` only when a threshold fails or a controlled product
experiment proves the declared improvement. Local CPU timing cannot substitute
for staged Postgres/API evidence, and neither branch may be inferred from
missing data.

## Gate evidence

| Gate | Required threshold | Observed evidence | Verdict |
|---|---|---|---|
| Representative cardinality | 300,000 canonical groups | Local deterministic generator: 300,000 | `LOCAL_ONLY` |
| Logical peak×2 load | recorded concurrency and bounded candidate/result sets | 200 iterations at logical concurrency 32; coarse limit 1,000; result limit 200 | `LOCAL_ONLY` |
| Feed API p95 | ≤300 ms | unavailable; local in-process matcher p95 49.951 ms | `BLOCKED_STAGED_API` |
| Feed API p99 | ≤750 ms | unavailable; local in-process matcher p99 77.301 ms | `BLOCKED_STAGED_API` |
| Inventory DB CPU | ≤60% at peak×2 | unavailable | `BLOCKED_STAGED_DB` |
| Inventory DB buffers/IO/locks/saturation | within approved staged budget | unavailable | `BLOCKED_STAGED_DB` |
| Availability | ≥99.9% | unavailable | `BLOCKED_STAGED_API` |
| Indexed query plan | required indexes used by `EXPLAIN (ANALYZE, BUFFERS)` | SQL/index contract exists; no representative database plan collected | `BLOCKED_STAGED_DB` |
| Product advantage for hybrid | ≥3% relative improvement in cards actioned/session or application starts, 95% confidence, 14-day controlled snapshot-stability experiment, with no relevance/exhaustion regression | no controlled experiment | `NO_HYBRID_AUTHORIZATION` |
| Supply prerequisite | Paris/52 km/Fullstack has ≥12 fresh visible canonical groups or Product-approved expiring exception | seeded characterization proves matcher behavior only; production-like supply scorecard not attached | `BLOCKED_PR0_S` |

Local benchmark source: integrated commits `a7a85e1` and `db07b90`
(upstream evidence `8e7640c` and `3fefdbb`), command:

```bash
bun run --cwd packages/matching-oracle benchmark
```

The output status is `LOCAL_CPU_ONLY`, with build 1089.374 ms, p95 49.951 ms,
p99 77.301 ms, and null database CPU/saturation. These values are useful for
determinism and bound checks only; they are not release evidence.

## Decision

`DEFERRED_PENDING_STAGED_EVIDENCE` is binding. It authorizes neither
`ONLINE_FIRST` nor `HYBRID_HOT_COHORT`.

- Do not add generation/match tables, generation fanout, CAS activation, or
  hybrid storage from this artifact.
- Do not route production feed traffic to a new service from this artifact.
- Do not change canonical ingestion, candidate action, application, or profile
  writer ownership.
- Do not create a second authoritative writer.
- The existing feed characterization and matching oracle remain read-only
  evidence surfaces.

## Required evidence to reopen

1. Load a representative staged 300,000-group inventory snapshot containing
   the Paris/52 km/Fullstack golden cohort and rollout-segment distributions.
2. Apply the required job-document, geography, and candidate-action indexes.
3. Run the SQL contract from `packages/matching-oracle/src/query-plan.ts` with
   `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` and retain plan/buffer evidence.
4. Exercise the private API boundary at observed peak×2 concurrency; capture
   p50/p95/p99, errors, availability, DB CPU/IO/locks/saturation, and bounded
   candidate-set size.
5. Attach the PR0-S supply scorecard or a named Product-approved, expiring
   exception.
6. Select `ONLINE_FIRST` only if every online gate passes and the controlled
   product criterion does not authorize hybrid.
7. Select named `HYBRID_HOT_COHORT` cohorts only if an online performance gate
   fails or the pre-registered 14-day product experiment passes.

## Rollout and rollback boundary

This deferred decision changes no runtime behavior. When a branch is later
selected, rollout remains provider/country/cohort gated, the online matcher is
the correctness oracle/degraded path, only one response is visible, and rollback
changes routing flags only. Canonical inventory and primary candidate/action
writers remain authoritative.

## Approval

| Owner | Signature | State |
|---|---|---|
| Engineering owner | pending staged DB/API evidence | `NOT_SIGNED` |
| Product owner | pending product/supply evidence | `NOT_SIGNED` |

Absence of signatures is intentional and fail-closed. A later change must add
the measured evidence, explicit branch/cohorts, date, and both approvals; it may
not rewrite this absence as implied approval.
