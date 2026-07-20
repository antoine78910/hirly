# data.gouv source qualification and rollout

Classification: `TS_NEW`.

This runbook qualifies a data.gouv dataset before an adapter can become
production-eligible. Qualification is evidence only: it does not enable a
provider, source, transport, incremental schedule, backfill, or canonical
writer.

## Fail-closed qualification

Create one immutable evidence directory per dataset resource and snapshot
review. Record the dataset/resource IDs, metadata snapshots, licence text and
publisher attribution, representative rows, stable-ID comparison, employer
mapping, canonical apply-route checks, relevance review and lifecycle
semantics. Hash the reviewed artifact with
`qualifyDataGouvDataset`; preserve the returned digest with the review.

Reject the candidate when any condition is true:

- discovery is only a catalogue keyword match;
- the resource is older than its source-specific reviewed freshness window;
- commercial use, redisplay, retention or attribution rights lack explicit
  evidence;
- external IDs are absent or not stable across snapshots;
- employer identity is absent or unverified;
- a canonical HTTPS application route cannot be verified;
- reviewed rows do not contain relevant, actionable jobs;
- update cadence or removal semantics are unknown.

Do not infer rights from a data.gouv listing, invent inventory counts, or reuse
one dataset's policy evidence for another resource. Thresholds come from the
reviewed source cadence and the week-one baseline, not from this module.

## Disabled registration

Every accepted candidate is still registered with:

```text
enabled=false
transport_enabled=false
incremental_enabled=false
backfill_enabled=false
```

`provider_registry.writer_runtime` remains the sole writer authority.
Production eligibility additionally requires the existing provider,
authorization, TypeScript ownership, source, transport, mode, country,
provider/source kill-switch and current production-policy gates. Qualification
cannot bypass any of them.

## Source matrix

| Source | Required evidence | Default |
| --- | --- | --- |
| Choisir le Service Public | Four snapshots, IDs/removals, routes, publisher attribution and Open Licence review | Disabled fixture/dry-run only |
| BPCE | Snapshot IDs/removals, direct routes, employer mapping, cadence and Open Licence review | Disabled fixture/dry-run only |
| Other data.gouv employment feeds | Full qualification artifact per resource | Rejected/disabled until qualified |
| Apec | Written partnership covering paid redisplay and retention | Partnership-only, disabled |
| La Bonne Alternance | Written commercial/third-party communication permission | Partnership-only, disabled |
| La Bonne Boîte | Separate employer-discovery product semantics, not vacancies | Rejected from canonical jobs |
| Credentialed ATS feeds | Signed tenant/provider authorization and source-specific policy | Partnership-only, disabled |
| Bright Data | Reviewed order form and redistribution rights | Containment/fallback only, disabled |

## Execution modes and safe reruns

1. **Dry run:** frozen resource snapshot and checkpoint; normalize, validate and
   deduplicate without canonical writes. Record fetched, normalized, rejected,
   actionable, duplicate and route counts plus named residuals.
2. **Backfill:** separate low-priority queue, bounded batch/concurrency and
   connection-pool budget. Checkpoint each complete partition. The backfill
   switch must pause work without affecting incremental readers.
3. **Incremental:** start only after dry-run parity, policy approval, explicit
   source/mode enablement and TypeScript provider ownership. Commit checkpoint
   atomically with occurrence/raw/canonical writes.

Rerun with the same source, resource version, scope and checkpoint. Stable
`provider:external_id`, snapshot content hashes and occurrence uniqueness make
the rerun idempotent. Never advance a checkpoint or expire inventory after an
incomplete, failed, killed or unreconciled run. An operator rerun may narrow
scope or force dry-run, but cannot override policy, ownership or kill switches.

## Observability and alerts

Every run logs redacted `run_id`, provider, source/resource, mode, country,
partition, checkpoint, stage durations/counts, requests, cost and terminal
completeness. No credentials, CV text or application payloads belong in logs.

Dashboard:

- last complete success and source lag;
- fetched → normalized → rejected → actionable → written reconciliation;
- source-reported total and named residuals;
- duplicate, invalid-route and expiry rates;
- queue age, request/cost and database saturation;
- source concentration and affected paid-cohort contribution.

Configure alert thresholds only after baseline evidence exists. Required alert
classes are stale source, volume/zero collapse, duplicate spike, invalid-route
spike, expiry spike, repeated authorization failure, queue age and database
saturation. Alert once per incident policy; a successful zero and an
incomplete zero are different terminal states.

## Kill switches, rollback and stop conditions

Provider, source/resource, country, incremental and backfill switches must work
without deployment. Source/country switches stop scheduling and read exposure;
they do not transfer cross-runtime writer ownership.

Rollback:

1. disable incremental/backfill schedules and source transport;
2. preserve immutable qualification, raw and run evidence;
3. stop reconciliation so incomplete runs cannot expire jobs;
4. restore the previous complete resource snapshot/checkpoint when applicable;
5. if ownership changed, transition the whole provider
   `typescript -> none -> previous runtime`; never run two writers;
6. replay idempotently and verify feed/application compatibility.

Stop or roll back on stale/zero collapse, duplicate/invalid-route/expiry spike,
queue or database pressure, policy expiry, writer ambiguity, failed
reconciliation, product/fulfillment gate regression, or any enablement without
source-specific written evidence.
