# PostHog AI observability

## Purpose

Hirly records each LLM request through the existing OpenAI OpenTelemetry
instrumentation. The instrumentor remains the sole producer of `$ai_generation`
facts (model, provider, tokens, latency, cost, and provider error). Hirly adds
one parent `gen_ai.hirly.*` span per product operation; it does not emit a parallel
business event for the same generation.

## Stable operation taxonomy

Every call must use `LLMObservation(operation, prompt_version, feature)`.
The parent span contains these queryable fields:

- `gen_ai.hirly.operation` — stable operation identifier;
- `gen_ai.hirly.prompt_version` — explicit prompt contract version;
- `gen_ai.hirly.feature` — product feature owning the call;
- `gen_ai.hirly.actor_scope` — `user`, `system`, or `unknown`;
- `gen_ai.hirly.outcome` and `gen_ai.hirly.error_type` — terminal result;
- `gen_ai.hirly.raw_content_retention_days` — contractual retention target: `30`.

Current operations include CV text/profile extraction, application-document and
Greenhouse-answer generation, job-match scoring, application-agent decisions,
career-coach workflows, onboarding suggestions, and recording transcription.

## Raw prompt/output policy

Set `POSTHOG_AI_RAW_CONTENT_ENABLED=true` and
`POSTHOG_AI_RAW_CONTENT_RETENTION_DAYS=30` only after the PostHog project has:

1. a 30-day retention policy for AI observations;
2. access restricted to approved admin/engineering roles; and
3. an incident process for deleting/containing sensitive observations.

When enabled, the adapter stores raw **text** input/output on its governed
parent span as `gen_ai.hirly.raw_input` and `gen_ai.hirly.raw_output`. It intentionally
does not enable the OpenAI instrumentor's global content-capture option: that
would upload base64 CV images and audio bytes, which are neither useful nor
bounded analytics payloads. OCR and transcription still retain their textual
instruction/output, model, tokens, latency, cost, error, and operation tags.

Never place API keys, authorization headers, cookies, or secrets in prompts.

## Reading the data

Use PostHog AI Observability to drill into a trace by `$ai_span_name`, which is
written as `hirly.<operation>.<prompt_version> <model>` on each generation.
Compare model/provider, token usage, total cost, latency, error rate, and
`gen_ai.hirly.outcome` between versions. A regression is a
change in error rate, latency, cost, or an operation-specific evaluation metric
after a prompt/model release.

For quality, record deterministic acceptance signals (valid JSON/schema,
accepted/rejected application proposal, successful CV extraction) as an
`$ai_metric` on the same trace. Do not treat model prose as a quality score.

## Release and rollback

1. Deploy with `POSTHOG_AI_RAW_CONTENT_ENABLED=false` and verify the new
   operation spans plus their child generations.
2. Confirm all call sites have stable operation/version tags and expected cost
   fields.
3. Configure and independently verify the PostHog retention/access controls
   above, set the explicit 30-day deployment gate, then enable raw text
   capture gradually.
4. Roll back raw capture immediately by setting
   `POSTHOG_AI_RAW_CONTENT_ENABLED=false`; operation, latency, error, token,
   and cost observability remains active.
