# Candidate Projection Writer Ledger (PR0)

Status: **characterized; producer activation blocked**
Classification: `PY_FIX` compatibility bridge for existing Python writers; future relay/consumer is `TS_NEW`.

This ledger inventories the current authoritative primary-database writers that
can change candidate matching intent, action exclusions, fulfillment state, or
serving eligibility. It is a PR0 characterization artifact only: no trigger,
outbox, relay, canonical writer, or production routing behavior is activated by
this change.

## Atomic source contract and activation gate

| Table/family | Required atomic primitive | Event version / idempotency source | Authoritative owner | Characterization test | Rollout flag |
|---|---|---|---|---|---|
| `profiles` | Postgres `AFTER INSERT OR UPDATE OR DELETE` trigger writing `candidate_projection_outbox` in the same transaction | row-locked `candidate_event_versions` counter; `profiles:{user_id}:{version}:{operation}` | Existing FastAPI/profile writers | `test_candidate_projection_writer_ledger.py` inventory coverage; future duplicate/out-of-order trigger integration test | `BLOCKED_TRIGGER_NOT_IMPLEMENTED` |
| `swipes` | Postgres `AFTER INSERT OR UPDATE OR DELETE` trigger writing `candidate_projection_outbox` in the same transaction | row-locked candidate version; `swipes:{user_id}:{job_id}:{version}:{operation}` | Existing swipe API | ledger inventory coverage; future create/delete/undo trigger integration test | `BLOCKED_TRIGGER_NOT_IMPLEMENTED` |
| `applications` | Postgres `AFTER INSERT OR UPDATE OR DELETE` trigger writing `candidate_projection_outbox` in the same transaction | row-locked candidate version; `applications:{application_id}:{version}:{operation}` | Existing application APIs, admin APIs, generation worker, auto-apply queue, Gmail sync, expiry worker | ledger inventory coverage; future retry/crash/out-of-order trigger integration test | `BLOCKED_TRIGGER_NOT_IMPLEMENTED` |
| candidate-affecting `users` fields (consent, billing/paid cohort, account flags) | Postgres `AFTER INSERT OR UPDATE OR DELETE` trigger writing only opaque identifiers/changed-field class | row-locked candidate version; `users:{user_id}:{version}:{operation}` | Existing auth, billing, referral, admin-access writers | ledger inventory coverage; future field-filter and replay integration test | `BLOCKED_TRIGGER_NOT_IMPLEMENTED` |
| account deletion | Security-definer transactional `begin_candidate_deletion(user_id, idempotency_key)` RPC must commit the monotonic tombstone, fail-closed serving flag, and outbox event before cleanup | caller idempotency key plus monotonic deletion version; tombstone always outranks older events | `DELETE /profile` / `_delete_all_user_data` | current sequential cleanup is characterized below; future RPC retry/dead-letter/deletion-replay test | `BLOCKED_DELETION_RPC_NOT_IMPLEMENTED` |

The current adapter calls are sequential collection operations, so they do not
satisfy the atomic source contract. Consumers, schema, triggers, and deletion
RPC must deploy disabled first; producer-family flags may activate only after
duplicate, out-of-order, replay, and deletion tests pass. Disabling a relay may
pause projection activation but must never reverse a swipe, application, paid
status, consent revocation, or deletion tombstone.

## Complete current writer inventory

The line references are characterization anchors, not permanent interfaces.
The regression test AST-scans production Python for direct writes to the four
authoritative collections and fails if a writer owner is absent from this file.

### Profile/search-intent writers — `profiles`

| Current owner(s) | Endpoint/background path | Matching-relevant surface | Required source |
|---|---|---|---|
| `_ensure_demo_feed_profile`, `tutorial_session` | demo/tutorial onboarding (`backend/server.py:2094-2140`) | initial CV/role/location readiness | `profiles` trigger |
| `_save_coach`, `coach_interview_score` | coach state (`backend/server.py:6463-6520`) | profile mutation even when not projected as intent | `profiles` trigger with changed-field filtering |
| `upload_cv` | `POST /profile/cv` (`backend/server.py:6575-6690`) | CV-derived structured/profile defaults | `profiles` trigger; relay payload must exclude raw CV/contact text |
| `upload_profile_document`, `delete_profile_document` | `POST/DELETE /profile/documents` (`backend/server.py:6773-6843`) | document/profile revision | `profiles` trigger; purpose-limited projection only |
| `upload_cover_letter`, `delete_cover_letter` | `POST/DELETE /profile/cover-letter` (`backend/server.py:6853-6922`) | profile revision | `profiles` trigger; no cover-letter text in outbox |
| `update_application_defaults` | `PUT /profile/application-defaults` (`backend/server.py:7032-7068`) | application preferences | `profiles` trigger |
| `update_structured_profile_data` | `PUT /profile/structured-data` (`backend/server.py:7079-7175`) | role, skills, experience, education | `profiles` trigger |
| `patch_profile_extras` | `PATCH /profile/extras` (`backend/server.py:7182-7190`) | auxiliary profile state | `profiles` trigger with changed-field filtering |
| `update_preferences` | `PUT /profile/preferences` (`backend/server.py:7306-7325`) | role, location, radius/work-mode intent | `profiles` trigger |
| `update_contact` | `PUT /profile/contact` (`backend/server.py:7334-7346`) | contact mutation; must not enter projection | `profiles` trigger with payload redaction/filtering |
| `_resolve_agent_missing_info`, `resolve_missing_info` | agent/application missing-info resolution (`backend/server.py:16504-16730`) | structured candidate answers may update profile | `profiles` trigger; purpose-limited feature allowlist |
| `_delete_all_user_data` | account cleanup (`backend/server.py:6993-7016`) | destructive profile deletion | deletion RPC tombstone first; trigger remains defense in depth |

### Candidate-action writers — `swipes`

| Current owner(s) | Endpoint/background path | Action semantic | Required source |
|---|---|---|---|
| `swipe` | `POST /swipe` (`backend/server.py:10405-10666`) | dismiss/right-swipe/application-start exclusion | `swipes` trigger |
| `apply_from_passed` | `POST /swipes/{job_id}/apply-from-passed` (`backend/server.py:10800-10817`) | removes prior pass before application path | `swipes` trigger |
| `delete_swipe` | `DELETE /swipes/{job_id}` (`backend/server.py:10821-10824`) | explicit action removal | `swipes` trigger |
| `undo_swipe` | `POST /swipe/undo` (`backend/server.py:10830-10838`) | removes latest swipe and possibly application | both `swipes` and `applications` triggers |
| `_delete_all_user_data` | account cleanup (`backend/server.py:6993-7016`) | destructive action deletion | deletion RPC tombstone first |

### Application/fulfillment writers — `applications`

| Current owner(s) | Endpoint/background path | Mutation class | Required source |
|---|---|---|---|
| `swipe`, `undo_swipe` | swipe-created application and undo (`backend/server.py:10405-10838`) | create/status/delete | `applications` trigger |
| `_process_application_generation_queue` | legacy generation queue (`backend/server.py:6337-6423`) | generation status/documents | `applications` trigger |
| `approve_application_documents`, `set_application_cv_source`, `edit_application_cover_letter`, `edit_application_resume` | candidate document APIs (`backend/server.py:10887-11084`) | approval/document revision | `applications` trigger |
| `_sync_application_status_from_auto_apply_result` | provider execution status bridge (`backend/server.py:11463-11475`) | submission status | `applications` trigger |
| `admin_ats_lab_generate`, `admin_add_application_note`, `admin_assign_application`, `admin_unassign_application`, `admin_update_application_status`, `admin_update_application_manual_status`, `admin_send_application_email` | admin application paths (`backend/server.py:14413-14928`) | generation, assignment, notes, manual/submission status | `applications` trigger |
| `_load_or_create_agent_application`, `_run_agent_apply`, `agent_submit` | agent apply path (`backend/server.py:14976-15259`) | create/generate/submit/status | `applications` trigger |
| `greenhouse_prepare_submit`, `greenhouse_validate_submit`, `greenhouse_submit` | Greenhouse path (`backend/server.py:16064-16485`) | create/prepare/validate/submit/status | `applications` trigger |
| `_resolve_agent_missing_info`, `resolve_missing_info`, `update_status` | candidate resolution/status APIs (`backend/server.py:16504-16820`) | answers and status | `applications` trigger |
| `enqueue_application`, `release_after_document_approval`, `backfill_pending_applications`, `_claim_next`, `process_application` | durable auto-apply queue (`backend/auto_apply/queue.py:233-677`) | queue state, lease/claim, retry, terminal result | `applications` trigger; repeated worker delivery must coalesce by version |
| `sync_gmail_application_emails` | Gmail reconciliation (`backend/gmail_sync.py:411-523`) | observed application status | `applications` trigger |
| `mark_application_offer_expired` | expiry worker (`backend/application_expiry.py:34-95`) | expired/credit-refund transition | `applications` trigger |
| `dev_applications_read_write_test` | dev-only repair endpoint (`backend/server.py:17628-17666`) | backfill/update | trigger remains mandatory outside production routing |
| `_delete_all_user_data` | account cleanup (`backend/server.py:6993-7016`) | destructive deletion | deletion RPC tombstone first |

### Consent, billing, cohort, and account-flag writers — `users`

| Current owner(s) | Endpoint/background path | Candidate-serving impact | Required source |
|---|---|---|---|
| `_upsert_auth_user_with_status`, `dev_login`, `tutorial_session` | auth/bootstrap (`backend/server.py:1636-1672`, `1981-1997`, `2107-2124`) | candidate existence/account state | `users` trigger with changed-field filtering |
| `_update_user_billing_by_user_id`, `_grant_friend_referral_billing`, `_repair_premium_credits_if_needed`, `_consume_application_credit`, `_refund_application_credit` | billing/credit helpers (`backend/server.py:2722-3329`) | paid/hot-cohort and fulfillment eligibility | `users` trigger |
| `_set_user_demo_account`, `_set_user_training_access`, `_set_user_require_review_before_send`, `_set_user_language`, `admin_grant_credits` | admin/account flags (`backend/server.py:12523-12556`, `13424-13437`) | cohort/exposure/review state | `users` trigger with projected-field allowlist |
| `get_or_create_friend_referral_code`, `enroll_friend_referral`, `redeem_friend_referral_code` | referral service (`backend/friend_referral_service.py:89-255`) | billing/entitlement mutation | `users` trigger |
| `_refund_application_credit` | expiry worker (`backend/application_expiry.py:19-26`) | credit refund | `users` trigger |
| `_delete_all_user_data` | current account cleanup (`backend/server.py:6993-7016`) | deletes applications, swipes, profile, sessions, user in sequential calls | replace entry path with deletion RPC; asynchronous cleanup runs only after tombstone commit |

No distinct persisted consent writer was found in the current production Python
surface. Consent revocation therefore remains an unimplemented authoritative
mutation family and must be added to the ledger before its producer flag can
activate. Billing fields are stored on `users`; they remain authoritative there
until a separately characterized owner migration occurs.

## PR0 boundary verdict

- Canonical job ingestion and provider writer ownership are unchanged.
- Feed evaluation remains read-only in audit mode; it does not create provider,
  projection, reconciliation, matching, or supply work.
- No trigger, outbox table, relay, deletion RPC, or TypeScript primary writer is
  introduced here.
- PR1 may implement additive schema/consumers only after this ledger remains
  green against the writer-inventory regression test.
- Producer activation is blocked until the trigger/RPC integration tests and
  duplicate/out-of-order consumer tests exist.
