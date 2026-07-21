# G003 PR1 Contracts and Schema Repair Review

Checkpoint state: **BLOCKED pending corrected independent PostgreSQL evidence**

This artifact records the independent review for leader-owned Ultragoal
`G003-pr1-contracts-and-schema`. It does not mutate `.omx/ultragoal`, enable a
producer, relay, projection consumer, reconciliation worker, or serving route,
or authorize a hybrid schema.

## Audited blockers

| Blocker | Required proof | Current review state |
|---|---|---|
| Contract/schema parity | Explicit strict wire-to-row boundary plus exact regression coverage for every renamed or derived persistence field | **PENDING** — job-document mapper exists; candidate-action persistence parity follow-up requested |
| Candidate-scoped RLS | Direct candidate-table access fails closed under `SET ROLE`; only narrow single-candidate read functions may cross the table boundary | **PENDING** — self-selected custom-GUC policy rejected; replacement requested |
| Executable alias semantics | Runtime merge/split closure, cycle rejection, unrelated-group negative case, and cross-candidate denial | **PENDING** — implementation exists; dynamic fixture correction and rerun required |
| Independent verification | Fresh PostgreSQL 15 migration/up/down suite, focused contracts/tests, typecheck, lint, and diff hygiene | **BLOCKED** — first independent PG15 run found two stale fixtures |

## Independent failure evidence

Worker-3 ran the integrated migrations against a fresh
`postgres:15-alpine` container with:

```sh
CANDIDATE_MATCHING_MIGRATION_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/postgres \
  bun test tests/candidate-matching-common-schema.test.ts
```

Result: **7 passed, 2 failed**. Both failures were PostgreSQL `23502` errors:
`candidate_search_profiles.projected_at` was required by the parity migration
but omitted by the deletion and RLS/alias fixtures. No approval is possible
until the corrected integrated suite passes independently.

## Preserved boundaries

- Rollout remains disabled by default at producer, relay, projection, and
  serving controls.
- The common schema contains no generation, persisted candidate-job match,
  match fanout, or hybrid hot-cohort storage.
- Canonical job ingestion and authoritative candidate writers are unchanged.
- Rollback drops only additive projection/matching objects and preserves
  canonical `jobs`, `users`, and current Python-owned behavior.

## Verdict

**BLOCK.** Replace this verdict only after the corrected commits are integrated
and all required checks below pass with fresh output:

1. exact contract-to-persistence-row parity tests;
2. real `SET ROLE` direct-table denial and narrow single-candidate read proof;
3. executable merge/split alias and cycle proof;
4. PostgreSQL 15 migration/up/down suite;
5. focused contracts/tests, workspace typecheck/lint, and `git diff --check`.
