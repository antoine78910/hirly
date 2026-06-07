# Open Tasks

## Critical

### Greenhouse right-swipe pipeline

- Retest right swipe on a Greenhouse job.
- Confirm application package contains real tailored resume text and cover letter.
- Confirm Greenhouse browser prepare runs after swipe.
- Confirm final application status is not stuck at `not_submitted` when browser prepare has a result.
- Confirm Tracker displays `prepared`, `action_required`, `blocked_captcha`, `blocked`, or `prepare_failed` correctly.

### Application generation quality

- Prevent low-context output from being shown as fully tailored.
- If `cv_text_length < 300`, set `package_status=needs_profile_data`.
- If `job_description_length < 300`, set `package_status=needs_job_data`.
- Do not create empty DOCX sections.
- Surface generation quality status in Tracker.

### Supabase-only test update

- Active tests still reference Mongo fixtures and `MONGO_URL`.
- Replace Mongo fixtures with Supabase test fixtures or adapter mocks.
- Add smoke tests for:
  - Supabase Google session exchange.
  - `/api/profile`.
  - `/api/jobs/feed`.
  - `/api/swipe` right swipe.
  - DOCX fallback.
  - Greenhouse action-required classification.

## High Priority

### Action Required flow

- Verify Greenhouse browser required questions are stored as `prepared_missing_information`.
- Verify frontend displays readable labels/options.
- Verify saved answers update `profile.application_defaults`.
- Verify saved defaults are reused on the next prepare.
- Ensure legal/factual answers are never guessed.

### Browser submission UX

- Add a safe user-triggered browser submit path in frontend if this remains product direction.
- Keep `BROWSER_SUBMIT_DRY_RUN=true` by default.
- Never mark submitted unless success text/state is detected.
- Show CAPTCHA/manual verification state clearly.
- Store run screenshot and final URL.

### Feed performance

- Continue reducing Supabase full-table scans.
- Add top-level columns for any filters still evaluated only inside `data`.
- Track `feed_elapsed_ms`, `fallback_used`, and stage counts.
- Ensure new users get jobs in under 3 seconds for normal feed loads.

### Provider data quality

- Expand valid Greenhouse boards after current top 10.
- Expand valid Lever boards after current top 10.
- Add board health metrics in the UI or dev diagnostics.
- Disable stale/error-heavy boards automatically after repeated failures.

## Medium Priority

### Split backend modules

`backend/server.py` should eventually be split into:

- auth router
- profile router
- onboarding router
- jobs router
- swipe router
- applications router
- Greenhouse router
- Lever router
- dev diagnostics router
- services for feed, application generation, submission, and provider refresh

Do this after the critical product flow is stable.

### Decide Greenhouse API vs browser submit

The codebase currently has:

- Greenhouse public API form preview/prepare/validate/submit.
- Greenhouse hosted browser automation.

Decide which path is the production target for arbitrary employers. Keep the other as diagnostic until proven.

### Ashby direct sourcing

- Add `backend/job_providers/ashby.py`.
- Seed valid Ashby boards.
- Normalize into the same job schema.
- Add browser prepare benchmark only after Greenhouse/Lever behavior is clearer.

### Clean dependencies

Review and likely remove unused dependencies:

- `pymongo` if no active runtime/test import remains.
- Google/Gemini/LiteLLM packages if not used.
- Other migration-era packages no longer needed.

### Dev endpoint hardening

Review all `/api/dev/*` endpoints before deployment:

- Keep only safe diagnostics.
- Gate all dev-only routes.
- Remove endpoints that mutate production data unless admin-protected.
- Ensure no endpoint leaks secrets, raw CV content, or full browser screenshots unintentionally.

## Low Priority

### Frontend placeholders

- `DocumentsSheet` is a placeholder for supporting documents.
- Settings page has coming-soon actions:
  - theme picker
  - notification preferences
  - AI settings
  - product tour
  - subscription
  - restore purchase
- Industry filters exist in UI but jobs lack an industry field.
- Filter result count is a soft placeholder.

### Encoding cleanup

Some text/comments display mojibake characters. Clean visible UI strings and comments where needed.

### Temporary logs

Remove temporary console logs once auth/onboarding is stable:

- `AUTH_CALLBACK_RESPONSE`
- `AUTH_CONTEXT_ME`
- `ONBOARDING_AUTH_STATE`
- onboarding save/CV debug logs if still present.

### README updates

README should include:

- Supabase frontend env vars.
- Browser automation env vars.
- Dev login flag behavior.
- Supabase-only database status.
- Warning that Mongo scripts are archived legacy only.

## Technical Debt Inventory

- Monolithic `backend/server.py`.
- Mongo-like adapter API can hide expensive Supabase reads.
- Browser automation logic has provider-specific special cases.
- Greenhouse browser engine inherits from Lever browser engine.
- Tests lag behind Supabase migration.
- Multiple submission strategies coexist without a single product-level source of truth.
- OpenAI generation quality needs stronger validation.
- Provider refresh is synchronous in request paths in some cases.
- Application generation and browser prepare can make swipe latency high.
- Dev diagnostics are extensive and should be production-reviewed.

## Suggested Next Engineering Sequence

1. Retest current Greenhouse right swipe and inspect saved application document.
2. Fix any mismatched `submission_status` in application save/response.
3. Make Tracker action-required UX robust for Greenhouse browser questions.
4. Add generation quality guardrails and user-facing incomplete-package status.
5. Update Supabase-only test harness.
6. Remove or gate obsolete dev routes.
7. Split route modules only after the above is stable.
