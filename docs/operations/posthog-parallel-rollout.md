# PostHog parallel rollout

## Status and ownership

PostHog is additive to DataFast. The on-call engineering rollout owner runs the
capture, payment, refund, replay, and rollback gates. The growth/analytics
cofounder co-signs the DataFast baseline and canary evidence.

Local green checks establish `code_complete_local` only. Keep
`POSTHOG_PAYMENT_REVENUE_ENABLED=false`,
`POSTHOG_REFUND_REVENUE_ENABLED=false`, and the frontend replay profile off
until the credentialed gates below pass.

Record redacted raw exports, commands, summaries, decision, UTC timestamp, and
owner names in the leader-owned production-gate evidence directory. Never
commit secrets or raw customer data.

## Local rollback

1. Unset `REACT_APP_POSTHOG_TOKEN` to disable browser capture, or set
   `REACT_APP_POSTHOG_REPLAY_ENABLED=false` to select Profile A.
2. Rebuild and redeploy the CRA bundle; these are build-time variables.
3. Set the affected server switch to `false`.
4. Confirm DataFast queue/script, goals, checkout metadata, and first-party
   `/analytics/event` remain operational.

## Capture health

Export Railway JSONL with fields `timestamp`, `event`, `stripe_event_id`,
`semantic_id`, `status`, `latency_ms`, `currency`, and `amount_minor`, then:

```zsh
jq -s --arg start "$START_RFC3339" --arg end "$END_RFC3339" '
  [.[] | select(.timestamp >= $start and .timestamp < $end)
   | select(.event == "posthog_server_capture_succeeded"
         or .event == "posthog_server_capture_failed")]
  | {attempts:length,
     failed:map(select(.event=="posthog_server_capture_failed"))|length}
  | . + {failure_rate:(if .attempts==0 then null else .failed/.attempts end)}
' railway-posthog.jsonl
```

Rollback at 5% failures in 15 minutes with at least 20 attempts, or three
failures with fewer than 20 attempts. Promote the TypeScript outbox when a
complete 24-hour window exceeds 0.5% failures at 100 attempts, or has three
failed deliveries at any sample size.

## Complete Stripe event export

Requires Stripe CLI 1.42.8. First validate nested parameters:

```zsh
dry_run="$(stripe events list --type refund.updated \
  -d "created[gte]=$START_EPOCH" \
  -d "created[lt]=$END_EPOCH" \
  -d "limit=100" \
  --dry-run)"
printf '%s\n' "$dry_run" | jq -e \
  --arg gte "$START_EPOCH" --arg lt "$END_EPOCH" \
  '.dry_run.params.created.gte == $gte
   and .dry_run.params.created.lt == $lt
   and .dry_run.params.limit == "100"
   and .dry_run.params.type == "refund.updated"' >/dev/null
```

Use this fail-closed paginator for each required type:

```zsh
export_stripe_events() {
  local event_type="$1" output="$2"
  local cursor="" previous_cursor="" response="" has_more="" next_cursor=""
  local page_count=0 total_event_count=0 page_event_count=0
  : > "$output"

  while true; do
    local -a args=(events list --type "$event_type"
      -d "created[gte]=$START_EPOCH"
      -d "created[lt]=$END_EPOCH"
      -d "limit=100")
    [[ -n "$cursor" ]] && args+=(-d "starting_after=$cursor")
    response="$(stripe "${args[@]}")" || return 1
    printf '%s\n' "$response" |
      jq -e '.object == "list" and (.data | type == "array")
             and (.has_more | type == "boolean")' >/dev/null || return 1
    printf '%s\n' "$response" | jq -c '.data[]' >> "$output"
    page_event_count="$(printf '%s\n' "$response" | jq '.data | length')"
    total_event_count=$((total_event_count + page_event_count))
    page_count=$((page_count + 1))
    has_more="$(printf '%s\n' "$response" | jq -r '.has_more')"
    [[ "$has_more" == "false" ]] && break
    (( page_event_count > 0 )) || return 1
    next_cursor="$(printf '%s\n' "$response" | jq -er '.data[-1].id')"
    [[ -n "$next_cursor" && "$next_cursor" != "$previous_cursor" ]] || return 1
    previous_cursor="$next_cursor"
    cursor="$next_cursor"
  done

  jq -n --arg event_type "$event_type" --arg output "$output" \
    --arg start_epoch "$START_EPOCH" --arg end_epoch "$END_EPOCH" \
    --arg final_cursor "$cursor" --argjson page_count "$page_count" \
    --argjson total_event_count "$total_event_count" \
    '{event_type:$event_type,output:$output,start_epoch:$start_epoch,
      end_epoch:$end_epoch,pagination_complete:true,final_cursor:$final_cursor,
      page_count:$page_count,total_event_count:$total_event_count}' \
    > "${output}.manifest.json"
}

export_stripe_events invoice.payment_succeeded invoice.payment_succeeded.jsonl
export_stripe_events refund.created refund.created.jsonl
export_stripe_events refund.updated refund.updated.jsonl
export_stripe_events refund.failed refund.failed.jsonl
```

Reject command failures, malformed pages, empty pages with `has_more=true`,
repeated cursors, or incomplete manifests.

## Revenue reconciliation

Refund recognition uses the first lifecycle envelope that confirms success:
`refund.created` already succeeded, or `refund.updated` from a non-succeeded
status to succeeded. Sort envelopes by `(event.created,event.id)`, deduplicate
by `refund_id`, and exclude IDs in the append-only prior-day ledger. Refund
retrieval validates current status, amount, currency, and correlation only; it
does not create or move a recognition fact.

Query PostHog over the identical UTC bounds:

```sql
SELECT
  event,
  properties.invoice_id AS invoice_id,
  properties.refund_id AS refund_id,
  properties.stripe_event_id AS success_confirmation_event_id,
  properties.currency AS currency,
  min(timestamp) AS success_confirmation_time,
  count() AS copies,
  sum(toFloat(properties.revenue)) AS net_revenue
FROM events
WHERE timestamp >= {start:DateTime}
  AND timestamp < {end:DateTime}
  AND event IN ('payment_succeeded', 'payment_refunded')
GROUP BY event, invoice_id, refund_id, success_confirmation_event_id, currency
```

Any duplicate immediately disables the affected server switch. Missing facts
above 0.5% at 100 expected facts, three missing facts/day, or a per-currency
mismatch above the stricter approved threshold promotes the outbox.

## DataFast continuity

Export UTC day, goal name, and count for `lp_view`, `onboarding_started`, and
`onboarding_checkout_started`; compare DataFast-attributed Stripe checkout
sessions using preserved visitor/session metadata. Baseline is the median of
the seven complete pre-canary UTC days. At 100 upstream events, two consecutive
six-hour observations below 80% of baseline roll back PostHog. Lower samples
remain pending, never passed.

## Credential-gated replay

Build Profile A and prove custom/manual events work with no `/flags` or
`$snapshot`. Only after governance approval, build Profile B and inspect
representative CV, application, profile, auth, and payment screens. Confirm the
expected replay-control `/flags` request and replay traffic, with no readable
ordinary text/input, URL secrets, request/response bodies or headers, console,
canvas, cross-origin iframe, feature exposure, survey, autocapture, heatmap,
exception, dead-click, or pageleave capture.
