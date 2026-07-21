# G001 PR0 Characterization Checkpoint

Checkpoint state: **local implementation complete; production branch selection blocked**

This evidence supports the leader-owned Ultragoal checkpoint for
`G001-pr0-characterization`. It does not mutate `.omx/ultragoal`, select a
serving branch, authorize PR1, or change production routing/writer ownership.

## Integrated commits

- `b304c6e` — no-refresh Python feed characterization and initial TypeScript SQL evaluator.
- `2431628` — hardened candidate-scoped SQL oracle input.
- `61b8cef` — complete primary-writer ledger plus AST completeness regression.
- `32f066f` — writer-ledger evidence hygiene fix.
- `a7a85e1` — integrated deterministic matching oracle benchmark (upstream `8e7640c`).
- `db07b90` — integrated explicit-radius/query-plan parity fixes (upstream `3fefdbb`).
- `eeba561` — integrated independent PR0 production/supply boundary tests (upstream `05e4c30`).
- `af14519` — fail-closed serving-branch ADR.

## Changed-file inventory

### Existing Python compatibility surface — `PY_FIX`

- `backend/jobs_service.py` — coverage snapshot now records ordered canonical
  identities/job IDs, exclusion counts, route mix, and latency without writes.
- `backend/tests/test_feed_db_first.py` — no-refresh evaluator, canonical identity,
  and Paris/52 km/Fullstack 12-group characterization.
- `backend/tests/test_candidate_projection_writer_ledger.py` — AST inventory guard
  for every direct production write to `profiles`, `swipes`, `applications`, or
  candidate-affecting `users` state. Test-only Python; no exception comment needed.
- `docs/engineering/candidate-projection-writer-ledger.md` — current writer owners,
  required atomic trigger/RPC source, version/idempotency contract, test, and
  fail-closed rollout state.

No new production `.py` file was added.

### Isolated matching/audit surface — `TS_NEW`

- `apps/job-ingestion-audit/src/sql-evaluator.ts`
- `apps/job-ingestion-audit/test/sql-evaluator.test.ts`
- `packages/matching-oracle/package.json`
- `packages/matching-oracle/src/index.ts`
- `packages/matching-oracle/src/oracle.ts`
- `packages/matching-oracle/src/query-plan.ts`
- `packages/matching-oracle/src/types.ts`
- `packages/matching-oracle/test/fixtures/paris-fullstack.json`
- `packages/matching-oracle/test/oracle.test.ts`
- `packages/matching-oracle/test/boundary.test.ts`
- `packages/matching-oracle/benchmark/run.ts`
- `packages/matching-oracle/benchmark/README.md`
- `packages/matching-oracle/tsconfig.json`
- `bun.lock`

The oracle is deterministic, bounded, action/canonical-group aware, explicit
radius aware, and read-only. It does not write canonical jobs, candidate
projections/actions, match rows, tasks, or runtime flags.

### Decision evidence

- `.omx/plans/adr-matching-serving-branch.md` — status
  `DEFERRED_PENDING_STAGED_EVIDENCE`; intentionally unsigned.

## Verification evidence

| Check | Result |
|---|---|
| Existing feed characterization | PASS — 71 tests |
| PRD-requested related Python suite | PASS — 73 passed, 9 skipped (live endpoint tests skipped without configured backend) |
| Writer-ledger AST coverage/fail-closed state | PASS — 2 tests |
| Job-ingestion audit app | PASS — 66 passed, 1 PostgreSQL integration test skipped without database URL |
| Hardened SQL evaluator | PASS — 4 tests |
| Matching oracle and independent PR0 boundary contract | PASS — 8 tests |
| Matching oracle typecheck | PASS — `tsc --noEmit` |
| Audit app typecheck/lint | PASS — `tsc --noEmit` |
| Workspace package typecheck | PASS for config/contracts/db/ingestion/observability plus direct changed-package checks |
| Python static check | PASS — `py_compile` on modified Python/test files |
| Diff hygiene | PASS — `git diff --check` after `32f066f` |
| Live SQL/API benchmark | BLOCKED_EXTERNAL — no staged inventory/API/database credentials |

Independent verifier verdict: **APPROVE local characterization/oracle
integration; BLOCK serving-branch selection** until PR0-S real Paris fresh
canonical supply coverage and staged API/PostgreSQL peak×2 evidence exist.

## Local benchmark

Command: `bun run --cwd packages/matching-oracle benchmark`

```json
{
  "status": "LOCAL_CPU_ONLY",
  "cardinality": 300000,
  "iterations": 200,
  "concurrency": 32,
  "coarseLimit": 1000,
  "resultLimit": 200,
  "buildMs": 1089.374,
  "p95Ms": 49.951,
  "p99Ms": 77.301,
  "databaseCpuPercent": null,
  "databaseSaturation": null
}
```

The local result proves deterministic bounded execution only. It is not an API
SLO, database-plan, availability, or peak×2 production decision.

## Boundary and risk verdict

- Production feed behavior is preserved; audit mode disables provider refresh.
- Canonical ingestion and all primary profile/swipe/application/user writers
  remain authoritative and unchanged.
- No outbox trigger, relay, deletion RPC, projection writer, generation table,
  match table, fanout, CAS activation, feature flag, or production route is
  activated.
- The current account cleanup is sequential, not the required transactional
  tombstone RPC. Producer activation is blocked.
- No persisted consent writer was found; consent remains a missing authoritative
  mutation family that must be designed before producer activation.
- Seeded Paris correctness does not prove production supply readiness.
- `ONLINE_FIRST` cannot be selected without staged API/DB peak×2 evidence.
- `HYBRID_HOT_COHORT` cannot be selected without an online-gate failure or the
  pre-registered 14-day controlled product criterion.

## Downstream PR1 prerequisites

PR1 remains blocked until the leader/owners attach:

1. Representative 300,000-group staged inventory and the PR0-S Paris/52 km/
   Fullstack supply scorecard (or named Product-approved expiring exception).
2. `EXPLAIN (ANALYZE, BUFFERS)` evidence proving the required job-document,
   geography, and action-projection indexes.
3. Peak×2 API-boundary p50/p95/p99, error, availability, inventory DB CPU/IO/
   locks/saturation, and bounded-candidate-set evidence.
4. Explicit Engineering and Product signatures on the serving ADR.
5. Schema/consumer-first design for tolerant duplicate/out-of-order events.
6. Transactional table triggers and deletion RPC plan with per-family disabled
   rollout flags, replay tests, and rollback semantics.
7. Privacy approval for purpose-limited projections, retention, deletion replay,
   and absence of raw CV/contact/cover-letter data.

## Coordination protocol

Coordination protocol: coordinated - worker-1 integrated worker-2 oracle commits,
sent the writer-ledger/hygiene handoff to worker-3, preserved PR0-S and PR1 as
separate blocked boundaries, and retained the leader-owned Ultragoal as the sole
checkpoint authority.
