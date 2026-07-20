# Admin analytics migration

This migration changes presentation only. PostgreSQL remains the operational source
of truth, and no canonical writer or admin action moves to PostHog.

## Configuration

The migration is default-off:

```dotenv
REACT_APP_ADMIN_POSTHOG_ANALYTICS_ENABLED=false
REACT_APP_POSTHOG_ADMIN_DASHBOARD_URL=
```

Set the URL to a role-restricted PostHog dashboard or insight page. URLs
must use HTTPS and either a `posthog.com` host or the exact configured
`REACT_APP_POSTHOG_HOST`. URLs containing credentials or secret-bearing query
parameters are rejected.

The feature flag takes effect only when the relevant URL is valid. Missing or invalid
configuration fails closed to the legacy Hirly presentation.

## Reconciliation gate

Do not enable the migration until:

1. the warehouse privacy gate and corrected live identity canary pass;
2. immutable historical windows reconcile exactly and rolling windows remain within
   the approved one-percent or documented warehouse-lag bound;
3. PostHog workspace membership is restricted to the intended admin roles;
4. dashboard definitions identify owner, source, freshness, timezone, and the
   corrected-live history boundary;
5. user, billing/account, application, fulfillment repair, and attention-queue
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
