# G002 PR0-S supply readiness checkpoint

Checkpoint state: **repository contract documented; gate blocked on authorized
Paris inventory evidence**

This artifact supports the leader-owned Ultragoal checkpoint for
`G002-pr0-s-supply-readiness`. It does not mutate `.omx/ultragoal`, select a
matching serving branch, authorize PR1, deploy a worker, activate a source, or
transfer canonical writer ownership.

## Evidence reviewed

- `packages/matching-oracle/test/fixtures/paris-fullstack.json` is deterministic
  characterization data, not an inventory census.
- `backend/tests/test_feed_db_first.py` proves a no-refresh 12-group Paris
  characterization, not production-like supply availability.
- `docs/operations/job-source-readiness-matrix.md` records France-wide aggregate
  counts but does not bind the Paris/52 km/Fullstack cohort.
- `.omx/plans/adr-matching-serving-branch.md` correctly remains
  `DEFERRED_PENDING_STAGED_EVIDENCE` and identifies PR0-S as a separate gate.
- `docs/operations/candidate-matching-pr0-s-supply-readiness.md` now defines the
  reusable scorecard, expiring exception and rollout/rollback contracts.

## Review verdict

The current matching oracle preserves the important boundary properties:
explicit radius evaluation, fail-closed unknown coordinates, distinct
canonical-group identity, freshness/expiry filtering, action awareness and no
canonical writes. The supply evidence gap is operational, not evidence that
the seeded fixture should be promoted into a pass.

The existing Python no-refresh coverage snapshot is not itself a PR0-S
evaluator. Review identified four fail-closed requirements for the dedicated
scorecard implementation:

- never count its `provider:external_id` or `job_id` fallback as a canonical
  group;
- reject future publication timestamps plus inactive, invalid, expired or
  otherwise invisible jobs;
- bind the exact Paris coordinates, radius, role-family set, inventory snapshot,
  evaluation instant, release HEAD and input digest;
- keep exception evaluation pure and reject malformed, expired, revoked or
  cohort-mismatched approvals.

The release verifier must eventually hash/select the versioned PR0-S
contract/tool. Environment-specific scorecards remain immutable, append-only
evidence rather than repository defaults. Boundary tests must cover the full
evaluator surface so a later network, database mutation, writer or routing
dependency cannot be introduced unnoticed.

Current PR0-S verdict: `BLOCKED` with typed blocker `BLOCKED_EXTERNAL`.

Acceptable completion evidence is exactly one of:

1. a non-sample, immutable, digest-bound scorecard for the approved
   Paris/52 km/Fullstack cohort with at least 12 fresh visible distinct
   canonical groups; or
2. a named, Product-approved exception that is in scope, independently
   digest-verified and unexpired at evaluation time.

Neither outcome authorizes a matching serving branch. The staged API,
PostgreSQL, availability, privacy, approval and PR1 gates remain independent.

## Remaining evidence required

1. Authorized read-only production-like inventory snapshot and exact commit.
2. Frozen cohort/evaluation/action digests and ordered canonical-group digest.
3. Exclusion, duplicate, source-concentration and fulfillment-route evidence.
4. Independent digest/cohort/threshold verification.
5. If used, an append-only Product exception with an absolute expiry and
   rollback trigger.

## Change classification

`TS_NEW` documentation/evidence contract for an isolated TypeScript matching
surface. No production runtime, database writer or Python surface changed.
