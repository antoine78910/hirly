# G008 PR6 representative-load and observability checkpoint

Checkpoint state: **local shadow characterization complete; staged serving
evidence remains blocked externally**.

This checkpoint supports the leader-owned Ultragoal `G008-pr6-shadow-and-canary`.
It neither enables a serving route nor authorizes a canary: PR6 always exposes
the legacy response, and it performs no canonical, provider, job, or task
writes.

## Local characterization

Run the frozen paid/FR/fullstack/Paris-52km shadow exercise and retain its JSON
output:

```sh
bun run --cwd apps/matching-shadow-canary canary --execute-frozen \
  --output=artifacts/candidate-matching/g008-shadow-canary-local.json
```

The output includes the rollout selector, eligible-set parity, latency delta,
fresh visible canonical-group count, legacy/V2 error rates, query-plan
readiness, each gate decision, rollback reason, evidence digest, and the
zero-write side-effect counters. A passing frozen fixture is a deterministic
characterization only; it is not production, API, database, or availability
evidence.

The existing rollback proof is deliberately separate:

```sh
bun run --cwd apps/matching-shadow-canary evidence
```

It injects a latency breach, writes a rollback artifact, and exits non-zero by
design. It must not be used as a passing release command.

The bounded in-memory matcher characterization is also explicitly local:

```sh
bun run --cwd packages/matching-oracle benchmark
```

It reports 300,000 generated documents, p95/p99, logical peak×2 concurrency
(32 by default), and output/coarse bounds. Its `LOCAL_CPU_ONLY` status and null
database metrics prevent it from being mistaken for a serving-load result.

## Required staged evidence before a serving/canary decision

Run against an authorized, non-production staged matching API and a
representative 300,000-canonical-group inventory snapshot at the exact release
commit. Capture one immutable, digest-bound artifact containing:

1. API-boundary baseline and peak×2 p50/p95/p99 latency, request count, error
   rate, availability, and the tested cohort/selector;
2. database `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for the matching serving
   query, required index names, and an assertion that the plan has no sequential
   scan on the bounded candidate path;
3. database CPU, IO/buffers, lock waits, connection-pool pressure, and
   saturation during the peak×2 interval;
4. candidate-set and response bounds (at most 1,000 coarse candidates and 200
   visible results), eligible-set parity, fresh-supply gate, and V2/legacy error
   rates;
5. release commit, snapshot identity, input/result digests, timestamps,
   environment identity, explicit zero canonical/provider/task-write counters,
   and a rollback drill outcome.

The artifact must distinguish unavailable measurements from zero values and
must block authorization when any required metric, plan, or rollback proof is
missing. It must not send production traffic or mutate canonical state while
collecting evidence.

## Current verdict

`ONLINE_FIRST` and any user-visible canary remain **BLOCKED_EXTERNAL** pending
the staged artifact above. The synthetic benchmark and frozen shadow exercise
only establish deterministic, fail-closed local behavior; no local result can
replace API and PostgreSQL peak×2 evidence.

## Change classification

`TS_NEW` evidence contract/documentation for the isolated TypeScript matching
shadow surface. No Python or production runtime surface changed.
