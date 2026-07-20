# PRD / Execution Plan: Database Performance Journey Remediation

## Status

Planner revision 4 for deliberate `$ralplan` consensus review. Implementation and goal-mode execution are not active.

## Requirements summary

Remediate database load in this exact product order:

1. landing page
2. signup
3. onboarding
4. user application usage
5. admin panel

The work must preserve current product behavior, stabilize the existing Python-owned production runtime, and avoid a migration rewrite. Delivery is incremental: each journey receives characterization coverage, observability, additive database preparation, implementation, verification, and a rollback decision before the next journey begins.

Classification: **`PY_FIX`**.

## RALPLAN-DR summary

### Principles

1. Protect activation and fulfillment before maximizing architectural purity.
2. Push filtering, projection, mutation, aggregation, and joining to PostgreSQL when their semantics are testable.
3. Remove silent amplification first: local scans, read-before-write, per-row loops, oversized JSONB transfer, and retry multiplication.
4. Deploy additive schema before dependent application code and keep each journey independently reversible.
5. Treat query count, rows/bytes read, and fallback frequency as correctness properties, not optional profiling.

### Top decision drivers

1. **Production safety:** signup, onboarding, billing, feed, and submission behavior cannot regress.
2. **Load reduction per unit effort:** prioritize request paths by customer journey and eliminate multiplicative patterns before micro-optimizing.
3. **Rollback clarity:** schema and application changes must allow journey-level rollback without dual writers.

### Viable options

#### Option A — Safe adapter primitives plus journey-owned set-based contracts (chosen)

Pros:
- removes systemic amplification while respecting the requested journey order;
- keeps current ownership and API shapes;
- supports additive migrations and journey-level rollback;
- reusable, exact adapter primitives benefit later stages without making the adapter a general Mongo query compiler.

Cons:
- requires a clear boundary between generic primitives and explicit contracts;
- some complex admin/queue paths still need explicit SQL/RPC contracts;
- mixed generic and specialized query surfaces remain during rollout.

#### Option B — Journey-specific RPCs only; leave the generic adapter unchanged

Pros:
- narrow blast radius per route;
- SQL query shapes are explicit and independently explainable;
- fastest route for a few high-impact endpoints.

Cons:
- leaves read-before-write, projection, fallback, and bulk amplification throughout the rest of the product;
- duplicates data-access conventions;
- later stages repeatedly pay the same adapter debt.

#### Option C — Replace the Python database adapter with a TypeScript data service

Pros:
- aligns with the long-term stack direction;
- creates explicit typed contracts.

Cons:
- delays the production incident outcome;
- creates migration/cutover risk across auth, billing, onboarding, feed, fulfillment, and admin;
- violates the stack migration policy for an urgent existing-capability correction.

Option C is invalid for this initiative. Option B is incorporated into Option A for logical filters, JSONB mutation, claims, increments, bulk operations, joins, and aggregates. Generic adapter work is limited to exact registered scalar filters, compact projection, returned representations, observability, and fail-closed safeguards.

## Acceptance criteria

### Global

- No production path silently reads up to 1,000/10,000 full JSONB documents because a filter or sort could not be pushed.
- All intentional local-filter fallbacks are bounded, measured, and absent from landing/signup/auth/current-feed critical paths.
- Supported scalar updates execute without a preceding document GET.
- Nested JSONB mutations preserve unrelated fields and have concurrency characterization.
- Bulk mutations do not issue one read plus one or two network operations per row.
- Structured metrics expose database request count, rows/bytes read, fallback status, retry count, and latency by journey.
- Existing API response contracts remain compatible.
- `count_documents` never loads application rows on a critical path; unsupported critical counts use explicit count contracts or fail before issuing a broad read.
- Non-idempotent mutations are never automatically retried without an idempotency key.
- Database/RPC failures remain distinguishable from genuine empty results.

### Query/load budgets

Budgets distinguish **response rows/bytes** from **database work**. Response caps are API contracts; `EXPLAIN` buffer/row thresholds below bound work inside PostgreSQL.

- **Landing analytics:** maximum 20 events and 64 KiB/request; acknowledgement ≤8 KiB. Anonymous batch = one bulk insert and zero auth reads; authenticated batch = one joined auth lookup plus one bulk insert. Statement timeout = 1 s; total retry wall time ≤2 s.
- **Joined auth lookup:** returns at most one row and 16 KiB; statement timeout = 1 s.
- **`/auth/me` endpoint total:** valid bearer or cookie, including normal, creator, admin, and open-training variants, performs at most two application-DB operations total: one joined session/user/role-flags lookup and one bounded profile/training summary lookup. Invalid bearer plus valid cookie performs at most three. Invalid-only performs one. Creator/admin/training flags returned by the joined contract are reused; no duplicate creator/user read.
- **Signup/session exchange:** at most five application-DB operations without Gmail persistence and seven with it; each joined/auth response ≤16 KiB and profile response ≤64 KiB. Auth statements time out at 1 s and profile writes at 2 s.
- **Onboarding autosave:** one profile mutation, request and returned representation each ≤64 KiB, statement timeout = 2 s. Final completion = one composite profile mutation excluding invite/referral and checkout transactions; request/response each ≤256 KiB.
- **Cached feed:** at most eight database operations including authentication and final hydration, excluding external provider refresh. Each candidate query examines/returns at most 350 compact rows and 1 MiB; final hydration returns at most 25 jobs and 2 MiB. Statement timeout = 3 s.
- **Queue batch:** maximum 200 candidates; at most three set-based reads/claims plus two bounded writes. Each write batch ≤100 rows and 1 MiB; statement timeout = 5 s.
- **Gmail sync:** maximum 50 applications and 10 messages/application per invocation. At most four fixed reads plus `ceil(messages/100) + ceil(applications/100) + 1` writes; each write batch ≤100 rows and 1 MiB; no per-message DB read; statement timeout = 5 s.
- **Training:** published courses ≤2 queries and at most 200 courses/modules; user enrollments ≤3 and creator students ≤3, each returning at most 500 rows and 2 MiB; statement timeout = 3 s.
- **Notifications:** list = one query with default 50/max 100 rows; mark-all = one mutation capped at 500 notifications, after authentication; statement timeout = 2 s.
- **Admin:** overview/analytics ≤2 database operations and 512 KiB response; paginated users/applications ≤3 including bounded hydration and 2 MiB response. Default page = 100, maximum page = 500. Default date window = 30 days, maximum = 365 days. Statement timeout = 10 s. Responses include `generated_at`; cached overview/analytics freshness is ≤5 minutes, while transactional lists report their current query time.

### Database-work and rollout budgets

- Representative fixtures contain at least 100,000 users and 1,000,000 jobs/applications/events where relevant.
- Point lookups must use an intended index and must not execute a sequential scan at representative cardinality.
- Critical point/list queries may remove at most five rows by filter for every returned row. Bounded candidate/list queries may scan at most twice their configured return cap after index conditions.
- `EXPLAIN (ANALYZE, BUFFERS)` must show no temporary-file reads/writes. Shared-buffer ceilings: auth/profile ≤100 blocks, feed/queue ≤5,000, admin aggregate ≤25,000 at the representative fixture size.
- Idempotent auth reads allow at most two attempts within 1.5 s total; landing analytics within 2 s; other journey reads within 3 s. Mutations are not retried without a verified idempotency key.
- Rollout stages are 5% traffic for at least 30 minutes, 25% for at least 2 hours, then 100% for at least 24 hours before opening the next journey. Each stage needs at least 100 requests; otherwise extend the window.
- Roll back when, for 10 continuous minutes, endpoint error rate rises by either 0.5 percentage points or 20% relative (whichever threshold is reached first), p95 exceeds 110% of baseline, p99 exceeds 120%, DB retries exceed 1%, or any critical-path local fallback occurs. Also roll back if signup/onboarding success or verified-submission rate drops >2% relative, or fulfillment queue p90 age exceeds 110% of baseline.

### Journey order

1. Landing changes are verified and deployed before signup work is enabled.
2. Signup/auth changes are verified and deployed before onboarding work is enabled.
3. Onboarding changes are verified and deployed before user-application work is enabled.
4. User-application changes are verified and deployed before admin changes are enabled.
5. Each stage has an explicit rollback switch or application-version rollback path.

## Implementation plan

### Phase 0 — Baseline and safety harness

1. Add deterministic adapter request instrumentation around `_read_documents`, `_http_get_with_retries`, `update_one`, bulk mutations, and RPC calls in `backend/db/supabase_adapter.py:280-320`, `:932-1052`, and `:1133-1238`.
2. Record operation, table, pushed/local status, remote request count, rows returned, response bytes, elapsed time, retry count, and caller journey tag. Exclude filters/values that may contain PII.
3. Add characterization tests for `_postgrest_filter_params`, `SupabaseCursorAdapter`, updates, and bulk operations under `backend/tests/`, extending the existing cursor/adapter tests.
4. Capture production baselines through application metrics or Supabase dashboards before enabling behavior changes: landing analytics write rate, auth DB operations/request, onboarding writes/session, feed DB operations/request, queue batch operations, and admin payload/latency.
5. Inventory deployed columns/indexes using read-only catalog queries when connectivity is available; reconciliation is a hard pre-cutover gate before authoring or applying migration SQL.
6. Add overload tests and implement retry-policy mechanics behind per-journey configuration, without changing the global policy in Phase 0:
   - retry only idempotent reads and mutations carrying a verified idempotency key;
   - separate pool-acquisition, connect, and response timeouts;
   - cap total retry time;
   - use bounded exponential backoff with jitter;
   - expose retry-budget exhaustion and circuit/saturation metrics.
7. Enable those mechanics only as each journey is verified. Switch remaining generic/default behavior in Phase 4 or Phase 6 after landing, signup, and onboarding gates pass.

### Phase 1 — Landing page

1. Preserve the static landing render: it must continue to require no application DB reads (`frontend/src/pages/Landing.jsx:65-121`).
2. Define an explicit analytics allowlist and durability tiers:
   - critical: CTA/signup/onboarding conversion events;
   - best-effort: passive views and low-value interaction events.
3. Initial rollout batches but does not sample stored events. Any later sampling requires a separate approved loss/measurement policy. Client unload may lose at most one unsent best-effort batch. Critical events use a durable client outbox:
   - `localStorage` persistence survives reload and offline periods;
   - maximum 100 events or 256 KiB, TTL 24 hours;
   - FIFO eviction removes expired entries first, then oldest best-effort entries; critical-event overflow emits an operational metric and attempts immediate delivery rather than silently discarding;
   - every event has a client-generated event ID and every batch has an idempotency key;
   - server acknowledgements list accepted event IDs; timeout, missing acknowledgement, or `stored: false` retains events;
   - replay runs on app initialization, browser `online`, and bounded jittered backoff of 1/2/4/8/16 seconds followed by a 60-second cap;
   - payload sanitization excludes tokens and unapproved PII.
4. Add a bounded bulk endpoint to the existing Python analytics path. This remains `PY_FIX`. Do not add an in-process Python buffer. A new durable buffer, worker, queue, or processor would be a separately classified `TS_NEW` capability.
5. Introduce the minimal safe joined-session lookup required to resolve authentication once per batch, without switching general auth callers yet. Anonymous batches cannot supply a trusted user ID; authenticated attribution comes only from this contract.
6. Phase 2 must reuse this same joined-session contract for `/auth/me` and other authenticated routes; do not create a separate analytics-auth implementation.
7. Add uniqueness/idempotency for retried client batches so replay cannot duplicate critical events.
8. Enable and verify the new retry policy only for landing analytics operations.
9. Verify landing render, CTA navigation, anonymous and signed-in attribution, critical-event durability, and failure-open behavior.

### Phase 2 — Signup and authentication

1. Characterize the current session exchange and `/auth/me` contracts in `backend/server.py:1100-1196` and `:1316-1403`.
2. Add synchronized/indexed user lookup fields for Stripe customer/subscription identity, plus any auth lookup fields missing from the deployed schema.
   - Prefer stored generated columns derived from authoritative JSONB when expressions are immutable and deployment support is confirmed.
   - Otherwise use a database trigger with fixed semantics that maintains promoted fields from `data`.
   - Do not rely on distributed application dual writes.
   - Characterize null/deletion semantics and prove old-version JSONB writes cannot cause drift.
3. Replace nested JSON-path Stripe lookups at `backend/server.py:2355-2359` and `:3601-3614` with pushable indexed lookups.
4. Reuse and expand the joined-session contract introduced for authenticated analytics in Phase 1. It validates expiry in PostgreSQL and returns only required safe user fields plus bounded creator/admin/training flags. Preserve bearer→cookie fallback and cookie reissue semantics. `/auth/me` reuses those flags and performs only one additional bounded profile/training summary read; it must not repeat user, creator, or role lookups.
5. Extend adapter writes to request and consume returned representations, allowing `_upsert_auth_user` to avoid redundant reads after update/insert (`backend/server.py:1158-1183`).
6. Reuse the shared HTTP client for Supabase auth administration where safe instead of creating a new client per call (`backend/server.py:1232-1249`, `:1325-1333`).
7. Verify signup, existing-user login, session expiry, logout, deleted user, bearer/cookie fallback, Stripe webhook resolution, and billing correctness.
8. Enable and verify the retry policy for signup/auth operations only.

### Phase 3 — Onboarding

1. Lock current resume/persistence behavior from `frontend/src/pages/Onboarding.jsx:412-425`, `:897-929`, and `:1024-1042`.
2. Coalesce superseded step autosaves client-side and flush at navigation/final completion. Preserve explicit phone, invite/referral, CV, and checkout boundaries.
3. Add atomic profile patch contracts for step autosave and final completion so contact/preferences/extras can be merged in one database mutation without application-side read/merge/full-upsert.
4. Replace endpoint read→update→read sequences in `backend/server.py:6200-6208`, `:6211-6311`, `:6314-6327`, and `:6419-6464` with returned atomic mutations.
5. Ensure nested JSONB operations are server-side and preserve unrelated profile data under concurrent requests.
6. Verify normal completion, refresh/resume, repeated rapid step changes, CV upload, phone update, referral/invite redemption, and checkout handoff.
7. Enable and verify the retry policy for onboarding operations only.

### Phase 4 — User application usage

#### 4A. Generic adapter amplification

1. Keep generic adapter semantics intentionally narrow: exact registered equality/`$in`/range filters, compact projection, returned representations, instrumentation, and fail-closed safeguards.
2. Route logical filters, JSONB mutation, increments/claims, complex bulk operations, joins, and aggregates through explicit journey-owned SQL/RPC contracts.
3. Make unsupported fallback explicit and observable. Critical paths reject or use a specialized query before issuing a broad read.
4. Push supported projections into `select`; fetch `data` only when callers need the complete document.
5. Replace ordinary top-level updates with one-request returned PATCH paths. Use explicit SQL/RPC for atomic nested updates and increments.
6. Replace sequential `update_many`/`delete_many` behavior in `backend/db/supabase_adapter.py:1189-1208` with server-side/bounded bulk contracts.

#### 4B. Feed, swipe, application, and tracker

1. Preserve the current fast feed return at `backend/server.py:8961`; do not optimize unreachable legacy code unless it is deleted in a separate cleanup.
2. Retain compact candidate reads and final hydration (`backend/server.py:404-450`, `:7437-7460`, `:7789-7817`).
3. Add query-count tests for feed, swipe, application creation, tracker list/detail, notification listing, and application status changes.
4. Add synchronized/indexed application fields needed by queue and tracker queries, including queue/generation/status timestamps.
   - Prefer generated read-only columns derived from authoritative JSONB; otherwise use database-trigger synchronization or one authoritative mutation contract that prohibits legacy JSONB-only writes after cutover.
   - Generated columns must be excluded from adapter insert/update serialization while remaining registered for filtering.
   - Drift tests cover old-version writes, null/removal, queue claims, and every status transition.
5. Convert auto-apply backfill at `backend/auto_apply/queue.py:292-338` into bounded set-based reads and bulk updates; preserve duplicate-submission fencing.
6. Convert Gmail message existence checks and writes at `backend/gmail_sync.py:420-496` into preload/set-based reads and bounded batch writes.
7. Replace training N+1 reads at `backend/training_service.py:272-278` and `:690-759` with `$in` preloads or aggregate query contracts.
8. Replace notification mark-all per-row updates at `backend/notifications_service.py:61-69` with one bounded server-side mutation.
9. Enable and verify the retry policy for user-application operations, then switch remaining generic/default retry behavior only after earlier journey gates pass.

### Phase 5 — Admin panel

1. Preserve response shapes for overview, users, user analytics, analytics, and applications.
2. Replace full-dataset Python aggregation from `backend/server.py:11442-11503`, `:11785-12048`, and `:12970-13148` with purpose-built aggregate SQL/RPC views or functions.
3. Add bounded date windows and pagination to event/user/application endpoints; keep explicit maximums.
4. Keep compact selects and batched job hydration (`backend/server.py:11397-11439`); prohibit full profile/CV/job JSON on list endpoints.
5. Materialize or cache only aggregates whose freshness contract permits it; document refresh cadence and stale-data behavior.
6. Add admin query-count, row-count, response-size, and pagination tests.
7. Stop translating database failures into `[]` in `_admin_safe_find`/`_admin_safe_read` (`backend/server.py:11378-11413`). Return an explicit degraded/error response and emit an operational signal; genuine empty datasets remain distinguishable.
8. Enable and verify the retry policy for admin operations.

### Phase 6 — Cleanup and enforcement

1. Remove or quarantine unreachable feed code after behavior characterization, separately from the performance cutover.
2. Add static/unit checks preventing unregistered critical-path filters from silently entering local fallback.
3. Document specialized RPC/query ownership and adapter escape-hatch criteria.
4. Re-run the complete verification matrix and compare journey metrics against the Phase 0 baseline.

## SQL/RPC security contract

Every new RPC or database function must declare and test:

- invoker rights by default; `SECURITY DEFINER` only with documented necessity;
- fixed safe `search_path`;
- execution revoked from public/anonymous/authenticated PostgREST roles and granted only to the deployed backend service role, with catalog assertions against the actual deployed role names;
- the trusted identity source for each caller. The backend derives the actor user ID from the verified joined-session contract; browsers never provide a trusted actor or admin identity;
- ownership/tenant predicates inside user-scoped functions. Resource identifiers may be arguments, but the function must verify that the server-bound actor owns the resource;
- a server-verified admin identity plus an explicit database-side admin boundary for admin functions. A client-supplied email/flag is never sufficient;
- bounded inputs and a statement timeout appropriate to the journey;
- a minimal safe returned-column set;
- transactional behavior, idempotency key behavior, and concurrency semantics;
- explicit error behavior rather than false-empty results.

Because the service role can bypass row-level security, the Python route wrapper and database function together form the security boundary: the wrapper binds the actor from a verified session, and the function rechecks ownership/admin authorization. Direct browser execution remains revoked. Security tests cover cross-user resources, anonymous/direct execution, revoked grants, and non-admin aggregate access.

## Deliberate pre-mortem

### Failure scenario 1 — Atomic update path loses JSONB fields

- Trigger: a PATCH/RPC updates promoted columns but replaces `data`, or concurrent onboarding/profile writes overwrite sibling sections.
- Detection: characterization diff, concurrent integration test, sudden profile-completion/onboarding regression.
- Mitigation: server-side `jsonb_set`/merge semantics, returned-row assertions, shadow comparison before enabling mutation path, journey rollback switch.

### Failure scenario 2 — New indexes/migrations worsen production availability

- Trigger: large backfill or index build blocks writes, exhausts I/O, or diverges from out-of-band production schema.
- Detection: lock wait, replication lag, elevated DB CPU/I/O, signup/feed error increase.
- Mitigation: reconcile live schema first, use generated/trigger-maintained fields with proven authority, chunk resumable backfills with progress records, use a production-safe nonblocking index strategy supported by the deployment path, deploy schema separately, stop before application cutover on regression.

### Failure scenario 3 — Load moves from PostgREST scans into oversized RPC aggregation

- Trigger: admin or queue RPC scans too much data, returns oversized results, or lacks selective indexes.
- Detection: `EXPLAIN` buffer growth, p95/p99 regression, response-size threshold, pool saturation.
- Mitigation: mandatory date windows/pagination, representative-cardinality explain tests, statement timeout, bounded batches, per-journey rollout.

### Failure scenario 4 — Trusted identity or analytics replay is confused

- Trigger: an RPC trusts a client-provided actor/admin field, or the analytics outbox deletes unacknowledged events and then replays a duplicate after reload.
- Detection: cross-user negative test, direct-execute grant test, failure→reload→replay integration test, duplicate event-ID metric.
- Mitigation: server-bound identity plus database ownership checks, revoked browser grants, explicit accepted-event acknowledgements, stable event/batch IDs, TTL/cap metrics, and idempotent inserts.

## Expanded verification plan

### Unit

- Filter/operator translation, projection translation, mutation payloads, local-fallback guards, retry metrics, batching/idempotency, and response compatibility.

### Integration

- PostgreSQL/PostgREST adapter tests against representative tables and indexes.
- Concurrent JSONB mutation tests.
- Migration/backfill/index tests.
- Query-count tests with fake HTTP transport and PostgreSQL statement capture.

### End-to-end

1. Landing load → CTA.
2. Signup → session exchange → `/auth/me`.
3. Onboarding resume and completion.
4. Feed → swipe → application → tracker/status.
5. Admin overview → users → applications → detail.

### Observability

- Compare p50/p95/p99 latency, DB operations/request, rows/bytes/request, retries, fallbacks, error rates, pool waits, and business conversion/fulfillment gates before and after every journey.

## Rollout and rollback

1. Deploy observability only.
2. Deploy additive schema migration/backfill/indexes.
3. Verify old application version against the new schema.
4. Enable one journey’s application behavior behind configuration.
5. Observe the 5%/30-minute, 25%/2-hour, and 100%/24-hour windows and numeric rollback formulas above; extend a stage until it has at least 100 requests.
6. Roll back application behavior while leaving additive schema in place; do not run destructive down migrations after application dependency.
7. Proceed to the next journey only after acceptance.

## Risks and mitigations

- **Semantic drift from Mongo-like filters:** do not broaden generic logical semantics; use explicit contracts.
- **Out-of-band schema drift:** live catalog reconciliation is a release prerequisite.
- **Retry storms:** implement operation-aware retry eligibility, idempotency, jitter, total retry budgets, and saturation metrics after baseline instrumentation.
- **Cross-journey retry coupling:** mechanics ship disabled in Phase 0 and are enabled journey by journey.
- **Analytics loss:** separate critical from best-effort events and test idempotency.
- **Promoted-field drift:** generated columns or database-enforced synchronization; never distributed application dual writes.
- **RPC privilege escalation:** fixed search path, least-privilege grants, bounded inputs, safe returns, and security tests.
- **Admin freshness changes:** explicit freshness contract and visible `generated_at`.
- **Scope expansion into migration rewrite:** remain `PY_FIX`; no TypeScript rewrite in this initiative.

## ADR

### Decision

Use narrowly scoped safe adapter primitives plus journey-specific set-based SQL/RPC contracts, delivered strictly landing → signup → onboarding → user application usage → admin.

### Drivers

- fastest safe reduction of production DB amplification;
- preservation of activation and fulfillment;
- journey-level verification and rollback.

### Alternatives considered

- journey-specific RPCs without adapter changes;
- TypeScript database-service migration.

### Why chosen

It removes systemic amplification without delaying incident remediation, while allowing explicit SQL for operations that do not fit a generic document adapter.

### Consequences

- The Python adapter remains production owner.
- SQL contracts become part of the tested application interface.
- Generic compatibility remains narrow; critical paths cannot rely on silent local filtering.
- Delivery requires additive migrations and observability before code cutover.

### Follow-ups

- Reassess bounded capability migration to TypeScript only after reliability gates stabilize.
- Remove obsolete compatibility paths after observation windows.
- Maintain a database-access contract and query-budget tests.

## Available agent types

`explore`, `analyst`, `planner`, `architect`, `critic`, `dependency-expert`, `debugger`, `executor`, `test-engineer`, `verifier`, `code-reviewer`, `security-reviewer` via the security workflow, `code-simplifier`, `git-master`, `researcher`, `writer`, and `vision`.

## Follow-up staffing guidance

### Recommended execution path while goal mode is externally owned: Team

- Leader/ledger: `$team`, frontier/high reasoning, owns journey ordering in its team task ledger without reading or writing Codex goal state.
- Lane 1: `executor`, medium reasoning — adapter instrumentation and safe pushdown/mutation primitives.
- Lane 2: `test-engineer`, medium/high reasoning — characterization, query-count, concurrency, and migration tests.
- Lane 3: `executor`, medium reasoning — current journey route/client changes only.
- Gate: `verifier`, high reasoning — confirms query budgets, functional parity, and rollout evidence before the next journey.
- Review: `code-reviewer`, high reasoning — reviews each journey diff independently.

Keep concurrent implementation lanes at two until the schema/adapter contract is stable. Later admin aggregation can add a third executor lane.

### Team launch hints

```bash
omx team 3:executor \"Implement Phase 0 and the currently approved journey from .omx/plans/prd-database-performance-journey-remediation.md; preserve journey ordering and return test/query evidence\"
```

or:

```text
$team 3 implement the next approved journey from .omx/plans/prd-database-performance-journey-remediation.md with one adapter lane, one journey lane, and one test/verification lane
```

### Team verification path

Before Team shutdown for each journey:

1. targeted functional and regression tests pass;
2. adapter/query-count tests prove the request budget;
3. migration validation and rollback evidence are recorded;
4. lint/typecheck/static analysis relevant to touched files pass;
5. verifier records product and technical gate results.

The Team leader records those artifacts in the repository/OMX team handoff before opening the next journey. It must not checkpoint or otherwise interact with goal state while another agent owns it.

### Ralph fallback

Use `$ralph` only if explicitly selected for a persistent single-owner fix/verify loop on one narrowly scoped journey. It is not the recommended ledger or multi-journey delivery mechanism.

## Goal-mode follow-up suggestions

- **Deferred/unavailable now:** another agent owns active goal state. This plan, its reviewers, and its execution handoff must not inspect, modify, pause, resume, or replace that goal.
- **Recommended immediate execution lane after Ralplan terminates:** `$team`, which can execute the five journeys without goal-state interaction.
- **Later, only after explicit ownership clearance in a new turn:** `$performance-goal` is a suitable evaluator-led workflow, or `$ultragoal` can provide a durable multi-journey ledger.
- **Research-only:** `$autoresearch-goal` is not appropriate unless the scope changes to a standalone performance-research deliverable.
- **No automatic transition:** this Ralplan stops after consensus and does not launch Team or any goal workflow.

## Planner changelog

- Incorporated the prior read-only database investigation.
- Corrected scope to the reachable fast feed path and excluded unreachable legacy feed code from primary optimization.
- Ordered delivery by the user’s five product journeys.
- Added deliberate pre-mortem, expanded test plan, rollout gates, staffing guidance, and goal-mode follow-up options.
- Limited generic adapter changes to exact primitives and moved complex semantics to explicit contracts.
- Added promoted-field authority, authenticated analytics batching, RPC security, retry remediation, false-empty admin handling, operational migration detail, and concrete query/load budgets from Architect review.
- Extended promoted-field authority to application status/queue fields, made landing reuse the later general auth contract, and made retry-policy enablement journey-scoped.
- Added response, scan/buffer, timeout, retry, rollout, and rollback budgets; endpoint-total `/auth/me` budgets; durable analytics outbox semantics; actor/tenant-aware RPC authorization; and explicit deferral of all goal-mode interaction.
