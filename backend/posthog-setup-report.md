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

## AI Observability

PostHog AI Observability has been wired into the project's OpenAI adapter (`llm_client.py`) using the OpenTelemetry auto-instrumentation approach. Every call to `complete_json_text` and `extract_text_from_image_bytes` now emits a `$ai_generation` event in PostHog carrying model name, token counts (input/output), latency, and estimated cost.

**How it works:**
- At startup, `server.py` initialises an OTel `TracerProvider` backed by `PostHogSpanProcessor` using the same `POSTHOG_SERVER_API_KEY` / `POSTHOG_HOST` env vars as the analytics client.
- `OpenAIInstrumentor().instrument()` is called once, patching `AsyncOpenAI` globally so all LLM calls are traced automatically — no changes to call sites were needed.
- A `ContextVar` (`_llm_user_ctx`) in `llm_client.py` carries the authenticated user's `distinct_id` through the async call chain. It is set in two route handlers: `upload_cv` (CV parsing + profile extraction) and `_generate_application_doc` (application generation). The tag is attached to the current OTel span so `$ai_generation` events are attributed to the correct person in PostHog AI Observability.

**New dependencies added to `requirements.txt`:**
```
posthog[otel]>=3.0.0
opentelemetry-sdk>=1.0.0
opentelemetry-instrumentation-openai-v2>=0.1.0
```

**Files changed:**
- `requirements.txt` — updated `posthog` to `posthog[otel]`, added OTel packages
- `server.py` — OTel initialisation in `startup_seed`; `set_llm_user_context` called in `upload_cv` and `_generate_application_doc`
- `llm_client.py` — added `set_llm_user_context`, `_tag_otel_span_with_user`, and `_llm_user_ctx`

**Verify AI Observability is working:**
- [ ] Install the new packages: `pip install -r requirements.txt`
- [ ] Trigger a CV upload or job application; check **AI Observability → Generations** in PostHog — you should see `$ai_generation` events with model, token counts, and latency within seconds.
- [ ] `claude_score_jobs` (job-feed scoring) and `transcribe_audio_bytes` are also auto-instrumented but run without a user context. They appear in PostHog as anonymous generations.

### Agent skill

We've left agent skill folders in your project at `.claude/skills/integration-fastapi/` and `.claude/skills/llm-analytics-setup/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
