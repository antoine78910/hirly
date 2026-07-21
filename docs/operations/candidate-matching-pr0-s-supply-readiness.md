# Candidate matching PR0-S supply readiness

This runbook defines the evidence contract for the candidate-job matching
`PR0-S` gate. It does not enable a provider, move canonical writer ownership,
select a matching serving branch, authorize PR1, or permit a production
deployment.

The gate asks one narrow question: does the approved Paris Fullstack cohort
have enough fresh, visible, distinct canonical job groups to support the
matching rollout? The current threshold is **at least 12 groups inside 52 km of
Paris**. Seeded fixtures and local matcher output characterize behavior but do
not satisfy this production-like supply gate.

## Current verdict

`BLOCKED` with typed blocker `BLOCKED_EXTERNAL`

The repository has a deterministic Paris fixture and a no-refresh feed
characterization with 12 groups. It does not contain a digest-bound snapshot
of an authorized production-like inventory census for the cohort. The existing
read-only inventory census is aggregate France-wide evidence and cannot be
reinterpreted as Paris/52 km/Fullstack evidence.

The serving-branch ADR therefore remains
`DEFERRED_PENDING_STAGED_EVIDENCE`. PR0-S completion alone would not satisfy the
separate staged API/PostgreSQL peak-times-two gate.

## Canonical cohort definition

Every scorecard must bind the exact cohort rather than a human-readable label:

| Field | Required value |
| --- | --- |
| Country | `FR` |
| Center | approved Paris latitude/longitude pair |
| Radius | `52` km, evaluated from explicit coordinates |
| Role family | approved Fullstack role-family identifier set |
| Freshness | the reviewed window and a captured `evaluatedAt` instant |
| Visibility | active, not invalid, not expired, role/country/radius/contract/work-mode eligible |
| Unit | distinct `canonicalGroupId`, never provider rows or raw job rows |
| Actions | snapshot either excludes candidate actions or binds the exact action snapshot digest |

Unknown job coordinates fail the radius check. Duplicate provider occurrences
count once. Manual fulfillment remains visible unless the cohort explicitly
excludes it; fulfillment readiness is reported separately and must not be used
to silently shrink the supply denominator.

## Reusable scorecard contract

A rollout scorecard is reusable only when the cohort and evidence are data,
not prose. Store one immutable JSON artifact per observation. At minimum it
must contain:

- schema and evaluator versions;
- exact release commit and environment;
- immutable inventory snapshot identifier and SHA-256 digest;
- `evaluatedAt`, freshness window, cohort definition and cohort digest;
- distinct visible canonical-group count and ordered group-ID digest;
- exclusion counts for inactive, invalid, expired, stale, role, country,
  radius, contract, work-mode and action filters;
- provider/source concentration and fulfillment-route mix;
- duplicate occurrence count and missing-coordinate count;
- threshold, verdict and typed blockers;
- generator command, operator identity and append-only artifact path.

The scorecard verdict is `READY` only when the evidence is non-sample,
digest-valid, the exact cohort matches, and the distinct visible count is at
least 12. `EXCEPTION` is reserved for an active, matching Product exception.
All other outcomes are `BLOCKED`. Missing or malformed fields fail closed. A
`BLOCKED_EXTERNAL` input produces a non-scoreable `BLOCKED` scorecard; it is
useful diagnostic evidence but never a readiness pass.

Use the same schema for later provider, country and rollout-cohort gates. Change
the cohort fields and threshold explicitly; do not copy a Paris result into a
different rollout segment. A scorecard never grants provider policy approval,
canonical writer ownership or serving-branch approval.

## Expiring Product exception gate

An exception is a temporary Product decision, not substitute inventory data.
It may discharge only PR0-S and must contain all of the following:

- unique exception ID and `PR0-S` gate ID;
- exact cohort digest and a minimum observed distinct-group count;
- business justification and quantified customer impact;
- named Product approver and Engineering risk owner;
- approval timestamp and an absolute ISO-8601 expiry timestamp;
- compensating controls, rollout ceiling and rollback trigger;
- exact release/rollout scope and an append-only approval artifact digest.

The exception must be approved before it becomes effective, must expire after
approval, and must be unexpired at every evaluation and rollout decision. It
cannot be open-ended, auto-renewed, inferred from chat, or broadened to another
cohort. Expiry or a digest/scope mismatch immediately returns the gate to
`BLOCKED_PR0_S`; already-running rollout traffic must follow the recorded
rollback trigger. Renewal requires a new exception ID, a fresh risk review and
a new expiry.

An exception cannot discharge staged latency, availability, database,
privacy, policy, writer-ownership or PR1 gates.

## Collection and review sequence

1. Obtain explicit authorization for a read-only production-like inventory
   census. Do not refresh providers or write canonical state.
2. Freeze the inventory snapshot, cohort definition, evaluation instant and
   candidate-action snapshot (when actions are applied).
3. Generate the scorecard from canonical indexed columns plus the authoritative
   source document. Retain the ordered group-ID digest, not sensitive payloads.
4. Independently verify the artifact digest, exact cohort, exclusions,
   duplicate collapse and route mix.
5. Record `READY`, `EXCEPTION`, or `BLOCKED` with typed blockers. Never turn a
   missing census into zero inventory or readiness.
6. Link the immutable scorecard or exception from the serving-branch evidence.
   Keep the separate staged API/database gate blocked until its own evidence
   passes.

## Rollout and rollback scorecard

For each provider/country/cohort rollout step, carry forward the immutable
PR0-S evidence and add the observed values below:

| Gate | Pass condition | Rollback trigger |
| --- | --- | --- |
| Supply | visible distinct groups remain at or above the approved threshold | threshold breach or evidence drift |
| Freshness | no regression in fresh relevant jobs per active profile | reviewed freshness budget breached |
| Quality | invalid, expired and duplicate rates stay inside the approved envelope | any envelope breach |
| Routes | direct/canonical and fulfillment-ready mix stays inside the approved envelope | route-quality regression |
| Reliability | feed latency, availability and fulfillment queue age stay inside their separate gates | any separate release gate breach |
| Ownership | exactly one canonical writer for every provider | dual writer or ownership ambiguity |
| Exception | named exception is in scope and unexpired | expiry, revocation or scope/digest mismatch |

Rollback is provider/country/cohort scoped: stop new traffic, disable the
source/schedule or routing flag, prove the writer can no longer claim or write,
and preserve evidence for diagnosis. Never mutate canonical inventory merely
to make a scorecard pass.

## Repository verification

The following checks protect the existing boundary:

```bash
bun test packages/matching-oracle/test
bun run --cwd packages/matching-oracle typecheck
bun run --cwd apps/job-ingestion-audit test
bun run --cwd apps/job-ingestion-audit typecheck
bun run verify:job-supply-release
```

The pure evaluator is implemented in
`apps/job-ingestion-audit/src/supply-readiness.ts` as
`buildSupplyReadinessScorecard`. It exports the reusable
`PARIS_FULLSTACK_SEGMENT` and
`PARIS_FULLSTACK_MIN_FRESH_VISIBLE_GROUPS` policy constants. Its scorecard
safeguards must always state that canonical writes, feature-flag changes,
exposure authorization and serving-branch selection are false.

The repository verifier is deliberately side-effect free. Remote census,
deployment, database and provider checks remain `BLOCKED_EXTERNAL` until an
authorized operator captures them separately.
