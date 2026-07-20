<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the Hirly FastAPI backend (`server.py`). A `Posthog()` client is initialized at startup using the `POSTHOG_SERVER_API_KEY` and `POSTHOG_HOST` environment variables, with `enable_exception_autocapture=True` for automatic error tracking. An `atexit` handler ensures all queued events are flushed on process exit. Seven business-critical events are now captured using the context API (`new_context()` / `identify_context()` / `capture()`), covering the full user journey from signup through job application to billing.

| Event name | Description | File |
|---|---|---|
| `user_signed_up` | New user completed authentication for the first time via Supabase OAuth | server.py |
| `user_logged_in` | Existing user authenticated via Supabase OAuth | server.py |
| `cv_uploaded` | User successfully uploaded and parsed their CV | server.py |
| `job_application_created` | User swiped right on a job, creating a new application | server.py |
| `job_dismissed` | User swiped left on a job, dismissing it from their feed | server.py |
| `checkout_started` | User initiated a Stripe billing checkout session | server.py |
| `account_deleted` | User deleted their account and all associated data | server.py |

## Next steps

We've built a dashboard and five insights to track key user behaviour:

- **Dashboard:** https://eu.posthog.com/project/228425/dashboard/834897
- **Signups & logins over time:** https://eu.posthog.com/project/228425/insights/Tz52MXf4
- **CV upload → job application funnel:** https://eu.posthog.com/project/228425/insights/gljvTTu4
- **Job applications vs dismissals over time:** https://eu.posthog.com/project/228425/insights/nFBxyE5t
- **Checkout started by billing plan:** https://eu.posthog.com/project/228425/insights/ugLXzMhO
- **Checkout → payment conversion funnel:** https://eu.posthog.com/project/228425/insights/LpFRpVK0

## Verify before merging

- [ ] Run a full production build (the wizard only verified the files it touched) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures. In particular, tests that import `server` will now require the `posthog` package to be installed.
- [ ] Install the new dependency first: in the project virtualenv run `pip install posthog` (or `pip install -r requirements.txt`) — the package was added to `requirements.txt` but the sandbox could not download it during this run.
- [ ] Add `POSTHOG_SERVER_API_KEY=` and `POSTHOG_HOST=` to any monorepo/bootstrap or CI secrets documentation so collaborators know what to set (they are already in `.env.example`).
- [ ] Confirm the returning-visitor path also calls `identify` — the `user_logged_in` capture in `_session_payload_from_supabase_token` runs on every Supabase token exchange, which is the primary auth path; verify any alternate auth flows (e.g. `auth_invite_email`) also result in an identify call.

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-fastapi/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
