#!/usr/bin/env bash
# Fires the 2 held-back eval cases (case-02, case-03) against the pinned agent version
# and collects verdicts + usage into results-v<N>.json. Run case-01 by hand first via LAUNCH.md.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; source .env; source IDS.env; set +a
BASE=https://api.anthropic.com/v1
H=(-H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
   -H "anthropic-beta: managed-agents-2026-04-01" -H "content-type: application/json")

VERSION="${1:-$AGENT_VERSION}"
OUT="evals/results-v${VERSION}.json"
echo "[]" > "$OUT"

run_case () {
  local case_dir="$1" candidate_json="$2" job_url candidate_file_id title sid resp

  job_url=$(cat "evals/$case_dir/input/job-source.txt")

  resp=$(curl -sS --fail-with-body "$BASE/files" \
    -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
    -H "anthropic-beta: managed-agents-2026-04-01,files-api-2025-04-14" \
    -F "file=@${candidate_json}")
  candidate_file_id=$(python3 -c "import json,sys; print(json.JSONDecoder(strict=False).decode(sys.argv[1])['id'])" "$resp")
  echo "uploaded $candidate_json -> $candidate_file_id"

  title="eval:$case_dir:v${VERSION}"
  resp=$(curl -sS --fail-with-body "$BASE/sessions" "${H[@]}" -d '{
    "agent": {"type":"agent","id":"'"$AGENT_ID"'","version":'"$VERSION"'},
    "environment_id": "'"$ENV_ID"'",
    "title": "'"$title"'",
    "resources": [{"type": "file", "file_id": "'"$candidate_file_id"'"}]
  }')
  sid=$(python3 -c "import json,sys; print(json.JSONDecoder(strict=False).decode(sys.argv[1])['id'])" "$resp")
  echo "started $case_dir -> session $sid"

  local task="Draft an evidence-backed job application. Candidate-evidence file: ${candidate_json} (attached to this session). Job source (URL — fetch it with web_fetch; if unreadable, stop and ask for pasted text): $job_url. Write application-pack.md, claim-map.json, and submission-plan.json to /mnt/session/outputs/."
  EVT=$(python3 -c "
import json,sys
task=sys.argv[1]
rubric=open('outcome.md').read()
print(json.dumps({'events':[{'type':'user.define_outcome','description':task,'rubric':{'type':'text','content':rubric},'max_iterations':3}]}))
" "$task")
  curl -sS --fail-with-body "$BASE/sessions/$sid/events" "${H[@]}" -d "$EVT" > /dev/null

  echo "$sid $case_dir" >> /tmp/eval-sessions-v${VERSION}.txt
}

run_case "case-02-grace-head-of-product-design" "synthetic-candidate-003-evidence.json"
run_case "case-03-brex-enterprise-ae" "synthetic-candidate-002-evidence.json"

echo
echo "Both eval sessions kicked off. Poll each with:"
echo "  curl -sS \"\$BASE/sessions/<session_id>\" \"\${H[@]}\" | python3 -c \"import json,sys; d=json.JSONDecoder(strict=False).decode(sys.stdin.read()); print(d['status'], [e.get('result') for e in d.get('outcome_evaluations',[])])\""
echo "Session ids recorded in /tmp/eval-sessions-v${VERSION}.txt"
