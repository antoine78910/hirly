# Job source readiness matrix

This is the authoritative repository-level readiness view for job inventory
sources. “Implemented” does not mean “permitted” or “enabled.” Trial readiness,
production readiness, and canonical writer ownership are independent gates.

No entry in this document authorizes a deployment, network trial, provider
activation, source enablement, or writer transfer.

## Read-only inventory census (2026-07-20)

A read-only aggregate query against the current Hirly jobs database measured
72,769 deduplicated jobs, 71,547 with a freshness timestamp inside 30 days, and
18,431 satisfying the existing strict application-capability predicate. These
are current inventory counts, not incremental-source estimates.

| Detected ATS | Observed unique jobs | Fresh inside 30 days | Strictly auto-applicable | Observed companies |
| --- | ---: | ---: | ---: | ---: |
| SmartRecruiters | 2,252 | 2,252 | 2,252 | 24 |
| Greenhouse | 939 | 440 | 440 | 15 |
| Lever | 800 | 93 | 93 | 11 |
| Taleez | 683 | 683 | 683 | 228 |
| Teamtailor | 174 | 174 | 174 | 15 |

The listed ATS jobs already exist within the 72,769-job total. A trial must
fetch the complete approved tenant board and report the post-deduplication
increment; it must not present these observed counts as new supply. On measured
inventory, SmartRecruiters and Taleez warrant the next policy/connector
evaluation, while Greenhouse and Lever are the first technically trial-ready
providers. Reproduce the aggregate without selecting job payloads or user data
with `docs/operations/sql/job-source-readonly-census.sql`.

| Source | Repository capability | Policy state | Trial ready | Production ready | Canonical writer | Primary blocker | Kill switch / rollback unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| France Travail | Python production collector; TS census/partition and normalization boundary | Existing API subscription must be verified for the target environment | Fixture/census ready; live census is `BLOCKED_EXTERNAL` without credentials | No TS cutover | Python | Live census plus scoped lifecycle RPC coverage; `lifecycle_claims_ready=false` blocks unsafe transfer | Whole `france_travail` provider; transition through `none`, never tenant-split writes |
| Greenhouse | Existing Python board collector; TS classifier, tenant discovery, bounded trial transport and evidence-only runner | `unverified` until a source-specific trial approval is recorded | Repository trial-ready; live execution remains blocked until exact tenant policy approval | No | Python | Current evaluation policy, 14-day paid-cohort evidence, complete-snapshot removal proof and later redisplay approval | Whole provider for canonical writes; individual tenants may be shadowed only without canonical writes |
| Lever | Existing Python board collector; TS classifier, tenant discovery, bounded global/EU trial transport and evidence-only runner | `unverified` until a source-specific trial approval is recorded | Repository trial-ready; live execution remains blocked until exact tenant policy approval | No | Python | Current evaluation policy, 14-day paid-cohort evidence, regional-host/removal proof and later redisplay approval | Whole provider for canonical writes; individual tenants may be shadowed only without canonical writes |
| Ashby | URL classification and tenant discovery; legacy Python adapter exists; no complete TS provider core | `unverified` | No—classification does not equal a trial connector | No | Python/legacy path only | Add a typed TS adapter/transport after measured ranking and policy approval | Discovery provider switch; no canonical TS writer |
| Choisir le Service Public | TS fixture adapter plus a bounded, digest-sealed evidence-only CSV trial transport and immutable trial runner | Open Licence 2.0 evidence qualifies the exact sealed resource for evidence-only evaluation; production remains false | Repository evidence-trial-ready only for the fixed resource/digest; no canonical writes | No | None | Snapshot is delayed/cumulative and has no description or canonical apply URL; repeat-sync freshness, expiry, duplicates, attribution and paid-cohort actionability remain unproven | Exact dataset/resource/digest plus source switch |
| BPCE | TS fixture adapter and reviewed source evidence; no enabled trial transport | Open Licence 2.0 and platform-display evidence are recorded, but the mutable export is not allowlisted for a run | `BLOCKED_EXTERNAL`: a fresh digest-bound capture and recruiter-PII redaction adapter are required before evidence persistence | No | None | Fresh digest, PII dropping, lifecycle/removal proof, paid-cohort value and direct-route validation | Exact dataset/resource/capture digest plus source switch |
| Qualified data.gouv feeds | Generic disabled-source qualification plus exact-resource, digest-bound evidence-only trial boundary | Per-resource licence, attribution and trial approval required; catalogue membership is insufficient | Conditional per resource: only a separately qualified exact manifest/policy allowlist can run; all others remain `BLOCKED_EXTERNAL` | No | None | Freshness, licence, attribution, stable IDs, PII, apply route, removal semantics and cohort value must pass per resource | Individual dataset/resource/version/digest |
| Apec | Fixture-backed core only | Partnership required | No live trial without partner sample and written rights | No | None | Partnership feed/API, commercial redisplay, retention, attribution and removal contract | Whole provider |
| La Bonne Alternance | No production connector in this boundary | Partnership-only; current commercial use must not be assumed | No | No | None | Written permission covering paid redisplay/retention and representative sample | Whole provider |
| HelloWork | Fixture-backed provider core | `unverified` | Fixture only | No | None | Approved API/feed or written permission | Whole provider |
| Welcome to the Jungle | Fixture-backed provider core | `blocked` | Fixture only | No | None | Written permission or approved partner feed/API | Whole provider |
| Indeed | Fixture-backed provider core | `blocked` | Fixture only | No | None | Approved partner/API inventory access | Whole provider |
| Bright Data | No authoritative repository source implementation | Contract-specific and not established here | No | No | None | Contract, actual dependency census, incremental value/cost bakeoff and replacement/containment decision | Vendor contract/budget plus source-wide switch |

## Readiness definitions

- **Fixture ready:** deterministic normalization and safety behavior can be
  tested without network or canonical writes.
- **Trial ready:** a reviewed, unexpired trial policy; exact tenant/resource
  allowlist; bounded transport; evidence-only persistence; repeated-sync
  reconciliation; and scorecard are all available. Trial commands cannot call a
  canonical writer or an application/fulfillment queue.
- **Production ready:** commercial/redisplay/retention rights, production access,
  measured paid-user value, lifecycle/removal proof, operational alerts,
  canonical ownership, canary and rollback have all passed.

## Non-negotiable ownership rule

Python and TypeScript may compare outputs, but only one runtime may mutate
canonical jobs for a provider. A tenant-level shadow trial is allowed because
it writes only noncanonical evidence. Canonical ownership transfers apply to the
whole provider and must pass through `writer_runtime=none`.
