# Test Specification: Database Performance Journey Remediation

## Test strategy

Lock functional behavior first, then measure query/request count and payload shape at each journey boundary. Every performance assertion must use deterministic fake PostgREST responses or a PostgreSQL integration fixture; wall-clock thresholds are reserved for controlled integration/e2e environments.

## Cross-cutting adapter tests

1. **Filter pushdown**
   - Existing registered equality, `$in`, and range filters generate the expected server-side PostgREST parameters.
   - Complex logical filters are tested through their explicit query/RPC contracts rather than expanded generically.
   - Unsupported critical-path filters reject before issuing a read.
   - Explicitly approved noncritical fallbacks are measured and bounded rather than silent or unbounded.
   - A limited local fallback never fetches more than its documented cap.
2. **Projection pushdown**
   - A projection containing supported top-level columns generates a compact `select`.
   - Full `data` is fetched only when requested or required for hydration.
3. **Mutation behavior**
   - A scalar top-level `$set` performs one remote mutation request and does not perform a preceding GET.
   - A nested JSONB update through an explicit mutation contract preserves unrelated keys.
   - Concurrent increments/claims remain atomic.
   - update/delete counts remain compatible with existing callers.
4. **Bulk behavior**
   - `update_many` and `delete_many` use bounded server-side operations or bounded batches, not per-row read/write loops.
   - Partial failure is reported without silently claiming all rows succeeded.
5. **Observability**
   - Every adapter call records operation, table, pushed-vs-local filter, rows fetched, payload bytes when available, remote request count, elapsed time, and retry count.
   - No secrets, CV text, tokens, or PII appear in logs.

## Journey 1: landing page

- A landing render does not require an application database read.
- Repeated low-value analytics events are client-batched according to the approved event policy; initial rollout does not sample stored events.
- Critical conversion events remain durable and preserve anonymous/user attribution.
- Anonymous batches perform no auth lookup; authenticated batches perform at most one joined auth lookup plus one bulk insert.
- Landing analytics and general authentication reuse the same joined-session contract; Phase 1 exercises it only for analytics and Phase 2 expands its callers.
- Critical-event batches are idempotent under replay.
- Critical-event outbox survives failure → reload → replay, retains events on timeout/missing acknowledgement/`stored: false`, and removes only explicitly acknowledged event IDs.
- Duplicate delivery of the same event ID or batch idempotency key produces one stored event.
- Outbox cap, TTL, FIFO eviction, critical-overflow metric, sanitization, and 20-event/64-KiB batch limits are deterministic.
- Analytics ingestion is fail-open for page interaction and returns within the existing client timeout behavior.
- E2E: load landing, click primary CTA, verify UI navigation is not blocked and critical events arrive once.

## Journey 2: signup/authentication

- Existing-email signup/session exchange resolves the same user ID as before.
- New signup creates exactly one user and one session.
- `/auth/me` returns the same payload and cookie behavior.
- Request-count contract:
  - authenticated request dependency performs at most one database round trip when the joined auth lookup is enabled;
  - invalid bearer plus valid cookie performs at most two joined lookups;
  - session exchange performs at most five application-database operations without Gmail token persistence and at most seven with it;
  - session exchange avoids redundant post-update user reads where returned representations are available.
- `/auth/me` endpoint-total contract:
  - valid bearer or cookie for normal, creator, admin, and open-training users performs at most two application-DB operations;
  - invalid bearer plus valid cookie performs at most three;
  - invalid-only performs one;
  - creator/admin/training flags from the joined lookup are reused and do not trigger duplicate user/creator reads.
- Expired, missing, bearer+cookie fallback, and deleted-user sessions retain current status codes.
- Stripe customer/subscription lookup uses indexed promoted columns or a database RPC and never locally scans user JSON.
- E2E: signup → session exchange → `/auth/me` → logout.

## Journey 3: onboarding

- Step-progress autosave coalesces superseded writes and flushes on navigation/final completion.
- Final onboarding completion persists extras, preferences, and contact without losing earlier fields.
- Characterization covers resume-after-refresh, CV upload, phone save, referral/invite redemption, and checkout handoff.
- Request-count contract: a normal step transition performs one logical profile mutation; final completion remains within the documented bounded request budget.
- Final completion performs one composite profile mutation, excluding independently transactional invite/referral redemption and checkout creation.
- Concurrent updates to contact/preferences/extras do not overwrite unrelated profile sections.
- E2E: signup → CV upload → preference steps → contact → completion → reload and verify persisted state.

## Journey 4: user application usage

- Feed results, ordering, swipe exclusion, applyability gates, and hydration remain equivalent on representative fixtures.
- Feed candidate reads remain column-only until final hydration.
- A cached feed request, excluding external provider refresh, performs at most eight database operations including authentication.
- Swipe, application creation, tracker list/detail, queue claim, Gmail sync, notifications, and training endpoints have query-count assertions.
- A queue batch performs at most three set-based reads/claims plus two bounded batch writes, independent of candidate count.
- Gmail sync performs at most four fixed reads plus `ceil(messages/100) + ceil(applications/100) + 1` writes; it performs no per-message database read.
- Published-course listing uses at most two queries; user-enrollment listing and creator-student listing use at most three each.
- Notification list and mark-all each use one database operation after authentication.
- Auto-apply backfill performs bounded set-based candidate/job/attempt reads and bounded bulk status writes.
- Gmail sync preloads existing message IDs and batches writes; duplicate email protection remains intact.
- Training course/enrollment/student endpoints avoid per-row user/course/module reads.
- Duplicate application/submission protections remain database-enforced.
- E2E: feed → swipe → application generation → tracker/detail → submission-status update.

## Journey 5: admin panel

- Overview, users, user analytics, analytics, and applications return compatible response shapes.
- Admin endpoints use aggregate SQL/RPC or paginated compact reads; they never load full CV/profile/job JSON unless a detail endpoint requires it.
- Admin overview and analytics use at most two database operations each; paginated user/application lists use at most three including bounded hydration.
- Admin database failure produces an explicit degraded/error result, while a genuine empty database produces a successful empty result.
- Date range and pagination parameters have deterministic defaults and maximums.
- Request-count and maximum-row contracts exist per endpoint.
- E2E: admin overview → users → applications → application detail.

## Integration and migration validation

- Apply additive schema migration to a PostgreSQL test database with production-like row distributions.
- Run `EXPLAIN (ANALYZE, BUFFERS)` for the auth, onboarding profile update, application queue, Stripe lookup, and admin aggregate query shapes.
- Fixtures contain at least 100,000 users and 1,000,000 jobs/applications/events where relevant.
- Assert intended index usage above the representative threshold, no sequential scan for point lookups, no temporary-file I/O, filter removals within the documented ratio, and shared-buffer ceilings of auth/profile ≤100, feed/queue ≤5,000, and admin aggregates ≤25,000.
- Re-run migration safely; verify down/rollback procedure where a down migration is provided.
- Verify old application code remains compatible before the application deploy.
- Verify generated/trigger-maintained promoted values cannot drift from JSONB under old-version writes, nulls, and deletion.
- Verify generated application queue/status columns are excluded from adapter write serialization while remaining filterable.
- Verify RPCs have fixed `search_path`, execution revoked from actual deployed public/anonymous/authenticated roles, backend-service-only grants, bounded input/statement timeout, and safe returned columns.
- For every user/admin RPC, verify the route derives the actor from the joined verified session, the function enforces ownership/admin boundaries, and a browser-supplied identity cannot become authoritative.
- Negative security cases: cross-user mutation/read, anonymous or direct PostgREST execution, revoked grant, client-supplied admin email/flag, and non-admin aggregate access.
- Verify application rollback leaves additive schema intact.

## Observability validation

- Dashboard or structured-log queries can report by journey:
  - DB requests per HTTP request;
  - rows and bytes read;
  - local-filter fallback count;
  - p50/p95/p99 adapter latency;
  - retries/timeouts;
  - pool wait saturation.
- Alert conditions:
  - any local fallback on signup/auth or current feed;
  - reads reaching `MAX_READ_ROWS`;
  - elevated retry rate;
  - journey p95 regression above the rollout threshold.
- Retry tests distinguish original requests from retries, prohibit replay of non-idempotent mutations without an idempotency key, and enforce a bounded total retry budget with jitter.
- Retry wall-time assertions: auth ≤1.5 s, landing analytics ≤2 s, other idempotent journey reads ≤3 s.

## Release gates

- Functional tests pass before performance changes are enabled.
- No regression in signup success, onboarding completion, feed availability, verified submission rate, duplicate prevention, or billing correctness.
- Each journey is deployed independently behind configuration where behavior changes materially.
- Rollout evidence covers 5% for ≥30 minutes, 25% for ≥2 hours, and 100% for ≥24 hours, with ≥100 requests per stage.
- Roll back on the documented 10-minute formulas: error rate +0.5 percentage points or +20% relative (first threshold reached), p95 >110%, p99 >120%, retries >1%, any critical fallback, signup/onboarding or verified-submission rate >2% relative decline, or fulfillment queue p90 age >110%.
- Admin tests assert default/max pagination (100/500), default/max date windows (30/365 days), 512-KiB aggregate and 2-MiB list response caps, statement timeout, and `generated_at` freshness semantics.
