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

**Fail-closed invariant:** Profile A is the only default. Keep both replay
variables and both server revenue switches `false` until the matching live,
credentialed evidence below is complete. Local tests establish
`code_complete_local`, never `production_ready`.

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

## Evidence workspace and decision record

The on-call engineering rollout owner executes capture, payment, refund, and
reconciliation gates. The growth/analytics cofounder independently co-signs the
DataFast baseline and canary. Never commit secrets or unredacted PII.

```sh
export GATE_DATE="$(date -u +%F)"
export RUN_STARTED_AT="$(date -u +%FT%TZ)"
export ROLLOUT_OWNER='REPLACE_WITH_ON_CALL_NAME'
export DATAFAST_COSIGNER='REPLACE_WITH_GROWTH_COFUNDER_NAME'
export EVIDENCE_DIR=".omx/ultragoal/posthog-parallel-rollout/evidence/production-gates/$GATE_DATE"
mkdir -p "$EVIDENCE_DIR"/{commands,raw-redacted,normalized,manifests,calculations,decisions}
```

Every credentialed run must contain this exact artifact set:

```text
commands/tool-versions.txt
commands/stripe-dry-run.json
commands/stripe-cursor-dry-run.json
commands/stripe-shim-argv.txt
raw-redacted/railway-posthog.jsonl
raw-redacted/{invoice.payment_succeeded,refund.created,refund.updated,refund.failed}.jsonl
raw-redacted/{invoice.payment_succeeded,refund.created,refund.updated,refund.failed}.jsonl.manifest.json
raw-redacted/posthog-revenue.jsonl
raw-redacted/datafast-seven-day.json
raw-redacted/datafast-canary.json
normalized/refund-recognition-ledger.jsonl
normalized/refund-candidates.jsonl
manifests/stripe-export-manifest.json
calculations/{capture-15m,capture-24h,reconciliation,datafast}.json
decisions/decision.json
```

Create the signed decision last; `production_ready` is forbidden when any
credentialed field is `blocked`, `pending`, or lacks an artifact:

```sh
jq -n \
  --arg run_started_at "$RUN_STARTED_AT" \
  --arg decided_at "$(date -u +%FT%TZ)" \
  --arg owner "$ROLLOUT_OWNER" \
  --arg datafast_cosigner "$DATAFAST_COSIGNER" \
  --arg build_sha "$(git rev-parse HEAD)" \
  --arg decision "blocked" \
  '{
    schema_version:1,run_started_at:$run_started_at,decided_at:$decided_at,
    build_sha:$build_sha,rollout_owner:$owner,
    datafast_cosigner:$datafast_cosigner,decision:$decision,
    profile_a:"required_default",profile_b_hostile_replay:"blocked_until_evidence",
    payment_revenue:"blocked_until_evidence",refund_revenue:"blocked_until_evidence",
    gates:{stripe_uuid:"pending",stripe_refund_lifecycle:"pending",
      posthog_reconciliation:"pending",datafast_canary:"pending",
      privacy_governance:"pending"},
    evidence_manifest:"manifests/stripe-export-manifest.json",
    notes:"Replace every pending state only from named evidence; retain co-signoff."
  }' > "$EVIDENCE_DIR/decisions/decision.json"
```

## Tool pins and exact UTC bounds

Use Stripe CLI **1.42.8**. A different version blocks the gate until the commands
are re-qualified.

```sh
stripe version | tee "$EVIDENCE_DIR/commands/tool-versions.txt"
stripe version | grep -Eq '(^|[[:space:]])1\.42\.8($|[[:space:]])'
jq --version >> "$EVIDENCE_DIR/commands/tool-versions.txt"
railway --version >> "$EVIDENCE_DIR/commands/tool-versions.txt"

export START_RFC3339='2026-07-19T00:00:00Z'
export END_RFC3339='2026-07-20T00:00:00Z'
export START_EPOCH="$(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$START_RFC3339" +%s)"
export END_EPOCH="$(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$END_RFC3339" +%s)"
test "$START_EPOCH" -lt "$END_EPOCH"
```

On GNU/Linux replace the two `date` expressions with
`date -u -d "$START_RFC3339" +%s` and `date -u -d "$END_RFC3339" +%s`.

## Stripe lifecycle export: dry run and fail-closed pagination

First prove that Stripe CLI 1.42.8 parsed the nested parameters, including the
cursor. Run these exact commands under `zsh`:

```sh
dry_run="$(stripe events list --type refund.updated \
  -d "created[gte]=$START_EPOCH" \
  -d "created[lt]=$END_EPOCH" \
  -d "limit=100" \
  --dry-run)"
printf '%s\n' "$dry_run" | tee "$EVIDENCE_DIR/commands/stripe-dry-run.json" |
  jq -e --arg gte "$START_EPOCH" --arg lt "$END_EPOCH" \
  '.dry_run.params.created.gte == $gte
   and .dry_run.params.created.lt == $lt
   and .dry_run.params.limit == "100"
   and .dry_run.params.type == "refund.updated"' >/dev/null

cursor_dry_run="$(stripe events list --type refund.updated \
  -d "created[gte]=$START_EPOCH" \
  -d "created[lt]=$END_EPOCH" \
  -d "limit=100" \
  -d "starting_after=evt_fixture_cursor" \
  --dry-run)"
printf '%s\n' "$cursor_dry_run" |
  tee "$EVIDENCE_DIR/commands/stripe-cursor-dry-run.json" |
  jq -e '.dry_run.params.starting_after == "evt_fixture_cursor"' >/dev/null
```

Use this exact exporter. It fails closed on command failure, malformed pages,
empty continuation pages, missing/repeated cursors, and incomplete pagination:

```sh
export_stripe_events() {
  local event_type="$1" output="$2"
  local cursor="" previous_cursor="" response="" has_more="" next_cursor=""
  local page_count=0 total_event_count=0 page_event_count=0
  : > "$output"

  while true; do
    local -a args=(
      events list
      --type "$event_type"
      -d "created[gte]=$START_EPOCH"
      -d "created[lt]=$END_EPOCH"
      -d "limit=100"
    )
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

  jq -n \
    --arg event_type "$event_type" --arg output "$output" \
    --arg start_epoch "$START_EPOCH" --arg end_epoch "$END_EPOCH" \
    --arg final_cursor "$cursor" --argjson page_count "$page_count" \
    --argjson total_event_count "$total_event_count" \
    '{schema_version:1,event_type:$event_type,output:$output,
      start_epoch:$start_epoch,end_epoch:$end_epoch,
      pagination_complete:true,final_cursor:$final_cursor,
      page_count:$page_count,total_event_count:$total_event_count}' \
    > "${output}.manifest.json"
}
```

Before credentials, test the exact argv and a two-page cursor using a PATH shim:

```sh
mkdir -p "$EVIDENCE_DIR/commands/stripe-shim-bin"
cat > "$EVIDENCE_DIR/commands/stripe-shim-bin/stripe" <<'SH'
#!/bin/zsh
print -r -- "$*" >> "$STRIPE_SHIM_ARGV"
if [[ "$*" == *"starting_after=evt_fixture_first"* ]]; then
  jq -n '{object:"list",data:[{id:"evt_fixture_second"}],has_more:false}'
else
  jq -n '{object:"list",data:[{id:"evt_fixture_first"}],has_more:true}'
fi
SH
chmod +x "$EVIDENCE_DIR/commands/stripe-shim-bin/stripe"
export STRIPE_SHIM_ARGV="$EVIDENCE_DIR/commands/stripe-shim-argv.txt"
: > "$STRIPE_SHIM_ARGV"
PATH="$EVIDENCE_DIR/commands/stripe-shim-bin:$PATH" \
  export_stripe_events refund.updated "$EVIDENCE_DIR/raw-redacted/shim-refund.updated.jsonl"
grep -F -- '-d created[gte]='"$START_EPOCH" "$STRIPE_SHIM_ARGV"
grep -F -- '-d created[lt]='"$END_EPOCH" "$STRIPE_SHIM_ARGV"
grep -F -- '-d limit=100' "$STRIPE_SHIM_ARGV"
grep -F -- '-d starting_after=evt_fixture_first' "$STRIPE_SHIM_ARGV"
jq -e '.page_count == 2 and .total_event_count == 2
       and .pagination_complete == true
       and .final_cursor == "evt_fixture_first"' \
  "$EVIDENCE_DIR/raw-redacted/shim-refund.updated.jsonl.manifest.json" >/dev/null
```

Then run against Stripe test credentials for all authoritative envelope types:

```sh
for event_type in invoice.payment_succeeded refund.created refund.updated refund.failed; do
  output="$EVIDENCE_DIR/raw-redacted/$event_type.jsonl"
  export_stripe_events "$event_type" "$output"
  test "$(wc -l < "$output" | tr -d ' ')" \
    = "$(jq -r '.total_event_count' "$output.manifest.json")"
done

jq -s '{
  schema_version:1,
  pagination_complete:all(.pagination_complete),
  page_count:(map(.page_count)|add),
  total_event_count:(map(.total_event_count)|add),
  per_type:(map({key:.event_type,value:.total_event_count})|from_entries),
  final_cursors:(map({key:.event_type,value:.final_cursor})|from_entries),
  exports:.
}' \
  "$EVIDENCE_DIR/raw-redacted/invoice.payment_succeeded.jsonl.manifest.json" \
  "$EVIDENCE_DIR/raw-redacted/refund.created.jsonl.manifest.json" \
  "$EVIDENCE_DIR/raw-redacted/refund.updated.jsonl.manifest.json" \
  "$EVIDENCE_DIR/raw-redacted/refund.failed.jsonl.manifest.json" \
  > "$EVIDENCE_DIR/manifests/stripe-export-manifest.json"

jq -e '.pagination_complete == true
       and .total_event_count == ([.exports[].total_event_count] | add)
       and .page_count == ([.exports[].page_count] | add)' \
  "$EVIDENCE_DIR/manifests/stripe-export-manifest.json" >/dev/null
```

The manifest records UTC bounds, page count, final cursor, per-type totals,
combined total, and `pagination_complete=true`. A truncated export, command
failure, malformed response, repeated cursor, or `has_more=true` empty page
blocks revenue. A Workbench/API export may replace this only when its receipt
proves the same bounds, event types, completion, and totals.

## Railway delivery failure calculations

Export Railway JSONL for the exact production service/environment and redact it
without deleting `timestamp`, `message`, `event`, `stripe_event_id`,
`semantic_id`, `status`, `latency_ms`, `currency`, or `amount_minor`:

```sh
export RAILWAY_SERVICE_ID='REPLACE_WITH_SERVICE_ID'
export RAILWAY_ENVIRONMENT_ID='REPLACE_WITH_ENVIRONMENT_ID'
railway logs --service "$RAILWAY_SERVICE_ID" \
  --environment "$RAILWAY_ENVIRONMENT_ID" --json |
  jq -c 'del(.email,.name,.payload,.api_key,.token)' \
  > "$EVIDENCE_DIR/raw-redacted/railway-posthog.jsonl"
```

Run the same calculation for a rolling 15-minute range and the previous complete
24-hour range by setting the matching UTC bounds:

```sh
calculate_capture_failures() {
  local start="$1" end="$2" output="$3"
  jq -s --arg start "$start" --arg end "$end" '
    [.[] | select(.timestamp >= $start and .timestamp < $end)
     | .capture_event = (.event // (
         if ((.message // "") | contains("posthog_server_capture_succeeded"))
         then "posthog_server_capture_succeeded"
         elif ((.message // "") | contains("posthog_server_capture_failed"))
         then "posthog_server_capture_failed"
         else null end))
     | select(.capture_event == "posthog_server_capture_succeeded"
           or .capture_event == "posthog_server_capture_failed")]
    | {attempts:length,
       failed:map(select(.capture_event=="posthog_server_capture_failed"))|length}
    | . + {failure_rate:(if .attempts==0 then null else .failed/.attempts end)}
  ' "$EVIDENCE_DIR/raw-redacted/railway-posthog.jsonl" > "$output"
}

calculate_capture_failures "$START_15M_RFC3339" "$END_15M_RFC3339" \
  "$EVIDENCE_DIR/calculations/capture-15m.json"
calculate_capture_failures "$START_24H_RFC3339" "$END_24H_RFC3339" \
  "$EVIDENCE_DIR/calculations/capture-24h.json"
```

- **15-minute rollback:** attempts are success plus failure. At 20 or more
  attempts, failure rate `>= 5%` disables the affected revenue switch
  immediately. Below 20 attempts, three failures also roll back.
- **24-hour outbox promotion:** at 100 or more attempts, failure rate `> 0.5%`
  promotes the TypeScript outbox. Three failures in a day promotes it at any
  sample. Record events intentionally lost after Stripe was marked processed.
- Any emitted malformed event or any failed same-UUID proof is immediate rollback.

## Append-only refund recognition ledger

The recognition time is the first Stripe lifecycle envelope that proves success,
not `Refund.created`. The ledger is append-only JSONL with this exact schema:

```json
{"schema_version":1,"refund_id":"re_123","semantic_uuid":"UUIDv5(payment_refunded:refund:re_123)","success_confirmation_event_id":"evt_123","success_confirmation_created_at":"2026-07-20T00:05:00Z","prior_status":"pending","new_status":"succeeded","amount_minor":2500,"currency":"EUR","invoice_id":"in_123","retrieval_validation":"succeeded","recognized_utc_day":"2026-07-20","recorded_at":"2026-07-20T00:40:00Z","rollout_owner":"NAME"}
```

1. Before canary, backfill all available `refund.created`, `refund.updated`, and
   `refund.failed` history into the ledger. Incomplete lifecycle history blocks
   refund revenue; do not infer recognition from a retrieved Refund object.
2. For each UTC day, wait 30 minutes, concatenate all completely paginated
   lifecycle pages, and sort envelopes by `(event.created, event.id)` regardless
   of export or delivery order.
3. State-fold by `refund_id`. A candidate is only:
   - `refund.created` with current status `succeeded`; or
   - `refund.updated` with current status `succeeded` and a present,
     non-succeeded `data.previous_attributes.status`.
4. Select the earliest confirmation envelope per refund and remove every
   `refund_id` already present in the prior append-only ledger. Later
   succeeded-bearing envelopes never move or duplicate recognition.
5. Retrieve the Refund only to validate current succeeded status, amount,
   currency, and invoice/customer/subscription correlation. Retrieval cannot
   create a candidate or change its timestamp.
6. Append validated new candidates without rewriting earlier lines. Save the
   proposed rows to `normalized/refund-candidates.jsonl`, diff against the ledger,
   then append with the named owner and `recorded_at`.

Use this fail-closed append step after the candidate file has the schema above:

```sh
ledger="$EVIDENCE_DIR/normalized/refund-recognition-ledger.jsonl"
candidates="$EVIDENCE_DIR/normalized/refund-candidates.jsonl"
touch "$ledger" "$candidates"
jq -e -s 'all(.[];
  .schema_version == 1
  and (.refund_id|type == "string" and length > 0)
  and (.semantic_uuid|type == "string" and length > 0)
  and (.success_confirmation_event_id|type == "string" and length > 0)
  and (.success_confirmation_created_at|fromdateiso8601)
  and .new_status == "succeeded"
  and (.amount_minor|type == "number" and . > 0)
  and (.currency|type == "string" and length == 3)
  and .retrieval_validation == "succeeded"
  and (.rollout_owner|type == "string" and length > 0))' "$candidates" >/dev/null

test "$(jq -r '.refund_id' "$candidates" | sort | uniq -d | wc -l | tr -d ' ')" = "0"
comm -12 \
  <(jq -r '.refund_id' "$ledger" | sort -u) \
  <(jq -r '.refund_id' "$candidates" | sort -u) |
  tee "$EVIDENCE_DIR/calculations/refund-ledger-collisions.txt"
test ! -s "$EVIDENCE_DIR/calculations/refund-ledger-collisions.txt"

before_count="$(wc -l < "$ledger" | tr -d ' ')"
candidate_count="$(wc -l < "$candidates" | tr -d ' ')"
cat "$candidates" >> "$ledger"
after_count="$(wc -l < "$ledger" | tr -d ' ')"
test "$after_count" -eq $((before_count + candidate_count))
```

Cross-day fixture: a pending envelope on D followed by the first
updated-to-succeeded envelope on D+1 belongs only to D+1. Out-of-order arrival is
normalized by envelope creation time and ID. A later succeeded update or retry is
excluded by the ledger. Failed, canceled, pending, and requires-action envelopes
are retained as non-recognized evidence.

## PostHog revenue and semantic reconciliation

Export this HogQL result as
`raw-redacted/posthog-revenue.jsonl` using the same UTC bounds:

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

Payments are expected from in-window `invoice.payment_succeeded` envelopes.
Refunds are expected only from new ledger rows recognized in that UTC window.
Compare semantic UUID, Stripe confirmation event ID/time, amount, currency, and
correlation. Never combine currencies.

- Any semantic ID with `copies > 1` immediately disables server revenue.
- Expected semantic facts are the missing-rate denominator. At 100 or more,
  missing rate `> 0.5%` promotes the outbox. Three missing in one day promotes it
  at any sample.
- For each currency, mismatch above
  `min(0.5% * abs(Stripe net), one major currency unit)` for two consecutive
  complete UTC days promotes the outbox.
- Store expected/actual counts, duplicate IDs, missing IDs, signed per-currency
  totals, thresholds, grace-period end, and decision in
  `calculations/reconciliation.json`.

Only after same-UUID concurrency proof and the first reconciliation pass may
payment revenue be enabled. Refund revenue additionally requires Stripe endpoint
API-version, subscribed lifecycle event names, `previous_attributes.status`,
immediate success, cross-day success, failed/canceled, retry, and out-of-order
evidence. Until then:

```sh
export POSTHOG_PAYMENT_REVENUE_ENABLED='false'
export POSTHOG_REFUND_REVENUE_ENABLED='false'
```

## DataFast seven-day baseline and canary

DataFast remains independent. Export seven complete pre-canary UTC days and the
canary window. Normalize each file to JSON arrays containing:
`utc_day`, `lp_view`, `onboarding_started`, `onboarding_checkout_started`,
`all_stripe_checkouts`, and `datafast_attributed_checkouts`. Attribution means
non-empty preserved DataFast visitor/session metadata on Stripe checkout.

Calculate the median seven-day baseline for:

1. `onboarding_started / lp_view`
2. `onboarding_checkout_started / onboarding_started`
3. `datafast_attributed_checkouts / all_stripe_checkouts`

```sh
jq '
  def ratio($n;$d): if $d == 0 then null else $n/$d end;
  def median:
    map(select(. != null)) | sort |
    if length == 0 then null
    elif length % 2 == 1 then .[length/2|floor]
    else (.[length/2-1] + .[length/2]) / 2 end;
  {
    schema_version:1,
    complete_utc_days:length,
    baseline:{
      onboarding_per_landing:
        (map(ratio(.onboarding_started;.lp_view))|median),
      checkout_per_onboarding:
        (map(ratio(.onboarding_checkout_started;.onboarding_started))|median),
      attributed_per_checkout:
        (map(ratio(.datafast_attributed_checkouts;.all_stripe_checkouts))|median)
    }
  }
' "$EVIDENCE_DIR/raw-redacted/datafast-seven-day.json" \
  > "$EVIDENCE_DIR/calculations/datafast.json"
jq -e '.complete_utc_days == 7
       and ([.baseline[]] | all(. != null))' \
  "$EVIDENCE_DIR/calculations/datafast.json" >/dev/null

Calculate each six-hour observation against that baseline, preserving sample
sizes and the fixed 80% boundary:

```sh
jq --slurpfile calculated "$EVIDENCE_DIR/calculations/datafast.json" '
  def ratio($n;$d): if $d == 0 then null else $n/$d end;
  . as $observations |
  {
    schema_version:1,
    baseline:$calculated[0].baseline,
    observations:($observations | map({
      observed_at,
      ratios:{
        onboarding_per_landing:
          ratio(.onboarding_started;.lp_view),
        checkout_per_onboarding:
          ratio(.onboarding_checkout_started;.onboarding_started),
        attributed_per_checkout:
          ratio(.datafast_attributed_checkouts;.all_stripe_checkouts)
      },
      upstream:{
        onboarding_per_landing:.lp_view,
        checkout_per_onboarding:.onboarding_started,
        attributed_per_checkout:.all_stripe_checkouts
      }
    }))
  }
' "$EVIDENCE_DIR/raw-redacted/datafast-canary.json" \
  > "$EVIDENCE_DIR/calculations/datafast-canary-calculated.json"
```
```

The current value is a complete rolling 24-hour ratio. With at least 100 upstream
events, a ratio below 80% of its seven-day median for two consecutive six-hour
observations rolls back PostHog and opens investigation. Below 100 upstream
events the gate is `pending`, never passed. A broken DataFast script/queue,
goal catalog, checkout metadata, or attribution test is an immediate blocker.
The growth/analytics cofounder records their name, UTC co-sign timestamp, export
links, ratios, sample sizes, and `pass|rollback|pending` decision in the signed
decision record.

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
