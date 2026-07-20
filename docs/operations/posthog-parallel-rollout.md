# PostHog parallel rollout

PostHog is additive to DataFast. DataFast remains live until the founders approve
its removal. Stripe/backend events are authoritative for revenue; browser events
are funnel signals only.

## Safety profiles

- **Profile A (default):** product and manually emitted web analytics. Automatic
  capture, feature flags, surveys, heatmaps, exceptions, and replay are disabled.
- **Profile B (blocked by default):** Profile A plus replay. It is not
  production-ready merely because `maskAllInputs` and `maskTextSelector` are set.
  Enable it only after a credentialed hostile replay inspection in the exact
  PostHog project and region proves that CVs, cover letters, email bodies,
  contact details, query strings, and application answers are absent.

Default-on analytics and replay create material EU/French privacy risk. Before a
production Profile B rollout, obtain the required consent/CMP and legal review,
execute the PostHog DPA, choose the approved region, update the privacy notice
and retention schedule, and document the lawful basis. The switches below are
technical gates, not evidence of compliance.

## Environment setup

Choose one PostHog region and use its matching host for both services:

```sh
# frontend/.env.local or deployment environment
export REACT_APP_POSTHOG_TOKEN='phc_project_token'
export REACT_APP_POSTHOG_HOST='https://eu.i.posthog.com'
export REACT_APP_POSTHOG_REPLAY_ENABLED='false'
export REACT_APP_POSTHOG_REPLAY_HOSTILE_QA_APPROVED='false'

# backend deployment environment
export POSTHOG_SERVER_API_KEY='phc_project_token'
export POSTHOG_HOST='https://eu.i.posthog.com'
export POSTHOG_PAYMENT_REVENUE_ENABLED='false'
export POSTHOG_REFUND_REVENUE_ENABLED='false'
```

Build-time `REACT_APP_*` values require a new frontend build. Profile B activates
only when both replay switches are `true`. Never expose a PostHog personal API
key in the frontend or backend capture variables.

## Profile A canary

1. Deploy with the frontend token/host set and both replay variables `false`.
2. Keep both backend revenue switches `false`.
3. In PostHog Live Events, verify one sanitized `$pageview`, one product event,
   and one `$identify` for a test account. Confirm URLs have no query or fragment.
4. Confirm there are no `$snapshot` or `$feature_flag_called` events and no
   `/flags` requests in the browser network panel.
5. Confirm the same user flow still appears in DataFast and that its script,
   queue, attribution cookies, and Stripe metadata remain operational.

## Credentialed hostile replay gate

Use a dedicated non-production account containing conspicuous fake secrets in
every sensitive surface: CV, cover letter, email body, phone, application answer,
review page, and URL query/fragment. In the target project:

1. Set both replay variables `true`, rebuild, and deploy to the canary.
2. Exercise all sensitive surfaces, including logout and cross-domain navigation.
3. Inspect the actual replay DOM snapshots, network payloads, console capture,
   canvas, and iframe behavior. Screenshots of configuration are not sufficient.
4. Record project, region, build SHA, tester, timestamp, inspected surfaces, and
   evidence links in the release ticket.
5. If any secret appears, immediately return both replay switches to `false`,
   rebuild, and delete the affected recording according to the incident process.

Only after this inspection and privacy approvals may
`REACT_APP_POSTHOG_REPLAY_HOSTILE_QA_APPROVED=true` be used in production.

## Revenue canary and reconciliation

Revenue is emitted after the existing Stripe webhook domain update. Stable
semantic UUIDv5 values make invoice and refund retries idempotent.

1. Enable payments only:

   ```sh
   export POSTHOG_PAYMENT_REVENUE_ENABLED='true'
   export POSTHOG_REFUND_REVENUE_ENABLED='false'
   ```

2. Create one canary subscription and replay its successful invoice webhook:

   ```sh
   stripe events resend evt_CANARY_INVOICE --webhook-endpoint we_CANARY
   ```

3. Verify exactly one `payment_succeeded` for the invoice after repeated resend.
   Compare `distinct_id`, `invoice_id`, currency, amount, plan/price, and Stripe
   event ID against Stripe and the Hirly billing record.
4. Export/query the complete time range using pagination; never validate only the
   first results page. Reconcile counts and signed sums by currency:

   ```sql
   SELECT properties.currency,
          count() AS events,
          sum(toFloat(properties.revenue)) AS net_revenue
   FROM events
   WHERE event IN ('payment_succeeded', 'payment_refunded')
     AND timestamp >= now() - INTERVAL 7 DAY
   GROUP BY properties.currency
   ORDER BY properties.currency
   ```

   Run the query in PostHog SQL/HogQL and compare every page/export row with the
   Stripe invoice/refund export for the same UTC window. Do not combine currencies.
5. Enable refunds only after payment reconciliation passes:

   ```sh
   export POSTHOG_REFUND_REVENUE_ENABLED='true'
   stripe events resend evt_CANARY_REFUND --webhook-endpoint we_CANARY
   ```

6. Test partial and full refunds plus repeated `refund.updated` delivery.
   Confirm only the terminal successful transition emits one negative revenue
   delta, linked to the original invoice. Pending, failed, and duplicate events
   must not change the total.

Repeat reconciliation daily during the canary and weekly thereafter. Investigate
missing/extra semantic UUIDs, not just aggregate variance.

## Rollback

Rollback is independent and does not touch DataFast:

```sh
# Immediate backend revenue rollback; restart/redeploy the backend.
export POSTHOG_PAYMENT_REVENUE_ENABLED='false'
export POSTHOG_REFUND_REVENUE_ENABLED='false'

# Immediate replay rollback; rebuild/redeploy the frontend.
export REACT_APP_POSTHOG_REPLAY_ENABLED='false'
export REACT_APP_POSTHOG_REPLAY_HOSTILE_QA_APPROVED='false'

# Full frontend PostHog rollback; rebuild/redeploy with these unset.
unset REACT_APP_POSTHOG_TOKEN REACT_APP_POSTHOG_HOST
```

After rollback, verify DataFast web events and Stripe attribution continue, the
Stripe webhook still updates Hirly billing state, fulfillment metrics are normal,
and PostHog receives no newly disabled event class. Keep the PostHog code path
available for diagnosis; do not remove DataFast until a separate founder-approved
cutover proves equivalent attribution and revenue reconciliation.
