# PostHog post-wizard report

The wizard completed a targeted PostHog integration for the Hirly frontend. The project already had a sophisticated instrumentation layer — `posthog-js` installed, a `PostHogProvider` wrapping the app, a hardened `posthogClient.ts` (with PII sanitization, an event allowlist, and a dual-sink `trackEvent` helper), and `PostHogLifecycle` handling pageviews and user identification. All 47 events in the `ALLOWED_CUSTOM_EVENTS` allowlist were already wired via `trackEvent()` calls throughout the app, with one exception: the in-app upgrade modal.

The wizard's contribution was:

- **Added `checkout_started` to `DesktopUpgradeModal.jsx`** — the only conversion event missing from the allowlist. Both checkout paths (new subscription and existing-subscriber upgrade) now fire the event with `source`, `plan`, and `interval` properties before navigating to Stripe.
- **Created `.env.local`** with `REACT_APP_POSTHOG_TOKEN` and `REACT_APP_POSTHOG_HOST` so PostHog initialises in local development.
- **Created a PostHog dashboard** with 5 insights covering the key business signals.

## Events added

| Event name | Description | File |
|---|---|---|
| `checkout_started` | Fired when the user initiates a paid checkout or plan upgrade from the in-app upgrade modal. | `src/components/upgrade/DesktopUpgradeModal.jsx` |

## Next steps

We've built a dashboard and five insights to keep an eye on user behaviour:

- **Dashboard**: [Analytics basics (wizard)](https://eu.posthog.com/project/228425/dashboard/834789)
- **Conversion funnel: Landing → Onboarding → Checkout**: [Yj74zgsA](https://eu.posthog.com/project/228425/insights/Yj74zgsA)
- **Job swipes over time**: [4PCE2swj](https://eu.posthog.com/project/228425/insights/4PCE2swj)
- **Application pipeline**: [LCLkHRh7](https://eu.posthog.com/project/228425/insights/LCLkHRh7)
- **Checkouts started by source**: [QdSSa0hv](https://eu.posthog.com/project/228425/insights/QdSSa0hv)
- **Auth successes by method**: [2vJLqB2j](https://eu.posthog.com/project/228425/insights/2vJLqB2j)

## Verify before merging

- [ ] Run a full production build (`yarn build`) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `REACT_APP_POSTHOG_TOKEN` and `REACT_APP_POSTHOG_HOST` to `.env.example` and any CI/CD environment configuration so collaborators and deployment pipelines know what to set.
- [ ] Confirm the returning-visitor path also calls `identify` — `PostHogLifecycle` already handles this via `useEffect` on `user?.user_id`, so verify it fires on hard refresh for authenticated users.

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-javascript_web/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
