# Admin analytics migration

This migration changes presentation only. PostgreSQL remains the operational source
of truth, and no canonical writer or admin action moves to PostHog.

## Configuration

The migration is default-off:

```dotenv
# Backend paid-lifecycle capture/outbox. This is a runtime variable.
POSTHOG_PAID_LIFECYCLE_ENABLED=false

# Frontend admin link. These are build-time variables.
REACT_APP_ADMIN_POSTHOG_ANALYTICS_ENABLED=false
REACT_APP_POSTHOG_ADMIN_DASHBOARD_URL=
```

The empty dashboard value is the immutable-URL placeholder. G005 records the URL
returned by authenticated readback of the verified private dashboard in project
`228425` in its non-secret journal; a public-share URL is forbidden. The checked-in
environment example remains empty. Recording the URL does not authorize deployment,
staging deployment configuration, or enabling either flag.

Set the URL to a role-restricted PostHog dashboard or insight page. URLs
must use HTTPS and either a `posthog.com` host or the exact configured
`REACT_APP_POSTHOG_HOST`. URLs containing credentials or secret-bearing query
parameters are rejected.

The feature flag takes effect only when the relevant URL is valid. Missing or invalid
configuration fails closed to the legacy Hirly presentation.

`POSTHOG_PAID_LIFECYCLE_ENABLED` also fails closed by default. Before changing it,
apply `20260721001950_pgcrypto_schema_compatibility.sql` to every PostgreSQL
database that will run the downstream paid-lifecycle migration, and verify the
resulting `public.digest` wrappers remain marker-owned, `SECURITY INVOKER`, and
`SET search_path = pg_catalog`. Then apply `20260721002000_posthog_paid_lifecycle.sql`
to the live PostgreSQL target and prove apply, function-only service-role privileges,
concurrency/fencing, dispatcher observability, down migration, unrelated-data preservation,
reapply, and one minimal record/claim/send flow. Local SQL parsing or a skipped
disposable-database suite is not sufficient evidence for this live rollout gate.

## Governed selector and query manifest

The canonical local contract is
`packages/contracts/src/posthog-customer-analytics.v1.json`. Its two referenced
HogQL files are immutable-by-hash inputs to G005. G005 must canonicalize and compare
the saved PostHog definitions to these hashes after authenticated readback; it must
not silently edit the local query shape while mutating PostHog.

The deliberate meaningful-activity selector is exactly this identified-person
allowlist:

- `job_dismissed`;
- `application_intent_started`;
- `job_application_created`;
- `cv_uploaded`;
- `onboarding_completed`.

Passive `$pageview` and `job_card_viewed` events are excluded, as are login, signup,
billing, admin, generic UI, and system events. Repeated allowed events still count
one distinct active person per window.

Let `D` be the `Europe/Paris` calendar date containing the cohort anchor. Every
window is half-open, right-censored users whose full end boundary has not elapsed are
excluded, and the four results are explicit non-cumulative observations:

| Horizon | Inclusive start | Exclusive end |
| --- | --- | --- |
| J0 | anchor timestamp | local midnight `D+1` |
| J1 | local midnight `D+1` | local midnight `D+2` |
| W1 | local midnight `D+7` | local midnight `D+14` (days 7-13) |
| M1 | local midnight `D+28` | local midnight `D+35` (days 28-34) |

For signup retention, the anchor is the earliest canonical backend
`user_signed_up` for the lowercase UUID `distinct_id`. The denominator is distinct
eligible signup users. Deliberate active rate is distinct eligible users with at
least one allowlisted event divided by that denominator. Engagement churn is the
exact complement from the same eligible/active join; zero denominator renders
`N/A`, never zero or infinity.

Paid subscription churn is a separate activation-cohort metric. Its anchor is the
earliest first-observed `subscription_activated`; its numerator counts only
`subscription_churned` in the same J0/J1/W1/M1 calendar windows. It must be titled
**First-paid activation-cohort loss** and described as paid subscription churn, not
engagement churn and not conventional current-subscriber period churn. If durable
paid-status loss cannot be proved, the card remains blocked/no-data; inactivity,
scheduled cancellation with access, trials, promotions, and transient payment
failure are not proxies.

## Reconciliation gate

Do not enable the migration until:

1. G005 authenticated readback proves the exact project, private/non-public
   dashboard, governed Action/query hashes, and intended PostHog workspace access;
2. the warehouse privacy gate and corrected live identity canary pass;
3. immutable historical windows reconcile exactly and rolling windows remain within
   the approved one-percent or documented warehouse-lag bound;
4. PostHog workspace membership is restricted to the intended admin roles;
5. dashboard definitions identify owner, source, freshness, timezone, and the
   corrected-live history boundary;
6. the live PostgreSQL paid-lifecycle gate above passes before enabling backend
   lifecycle capture;
7. user, billing/account, application, fulfillment repair, and attention-queue
   operations pass their Hirly smoke tests.

No PostHog personal API key belongs in a browser environment variable. The frontend
opens an external page and does not embed or proxy PostHog.

## Rollback

Set `REACT_APP_ADMIN_POSTHOG_ANALYTICS_ENABLED=false` and redeploy the frontend.
The legacy admin analytics pages and their database endpoints remain intact during
the bounded reconciliation window, so rollback changes no authoritative writer.
`/admin/user-analytics` also remains in Hirly because it contains database-backed
onboarding/profile and account context that is intentionally absent from the
privacy-contained PostHog projection.

Operational navigation remains available at:

- `/admin/overview`
- `/admin/users`
- `/admin/applications`
- `/admin/applications/:id`

Archive dashboards or remove legacy handlers only through a later approved change
after the rollback window closes.

## Local release evidence

The integrated local release gate must pass before an operator configures the
external dashboard:

- workspace TypeScript and lint checks;
- focused frontend identity, logout, event-delivery, and admin-boundary tests;
- focused Python analytics and operational-admin tests;
- analytics registry, warehouse containment, migration-ledger, and backfill tests;
- disposable PostgreSQL apply, least-privilege, replay-fencing, rollback, and
  reapply verification;
- a static scan confirming that browser code contains no personal PostHog key,
  authorization header, iframe, or first-party PostHog proxy.

The remaining actions are operator-only and are not performed by local
rehearsal:

1. create the role-restricted PostHog dashboard and record its immutable URL;
2. grant only the approved PostHog workspace roles;
3. set `REACT_APP_POSTHOG_ADMIN_DASHBOARD_URL` to that HTTPS URL;
4. reconcile immutable and rolling windows using the gate above;
5. enable `REACT_APP_ADMIN_POSTHOG_ANALYTICS_ENABLED` for the approved rollout;
6. monitor the product and fulfillment gates, and disable the flag immediately
   if any gate regresses.

Production imports, warehouse cleanup, credential rotation, dashboard archival,
and deployment require separate operator authorization. The local release does
not perform them.

## G005 mutation journal placeholders

G004 deliberately records no external object or URL as complete. G005 owns these
readback-derived fields in the non-secret manifest/journal:

- Action IDs for deliberate activity and signup entry;
- saved insight/query IDs and canonical definition hashes;
- private dashboard ID and immutable dashboard URL;
- before-state hashes and exact restore/delete verbs for every adopted/created
  object;
- final project/settings/access/non-public readback evidence.

Until all fields are populated from the authenticated production session and parity
passes, both flags remain `false`, the dashboard URL stays empty in environment
examples, PostgreSQL and Hirly admin endpoints remain operational truth, and no
production deployment or history import is authorized.
