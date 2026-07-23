#!/usr/bin/env bash
# Step-by-step, resumable launch for evidence-backed-application-agent.
# Each step reads IDS.env first and skips objects that already exist.
# If a call 400s on a field name, check the live docs (platform.claude.com/docs/en/managed-agents/*) — they win over this script.
set -euo pipefail
cd "$(dirname "$0")"

set -a; source .env; set +a
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "ANTHROPIC_API_KEY not set — paste it into .env first."; exit 1
fi
touch IDS.env
set -a; source IDS.env; set +a

BASE=https://api.anthropic.com/v1
H=(-H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
   -H "anthropic-beta: managed-agents-2026-04-01" -H "content-type: application/json")

jparse () { python3 -c "import json,sys; d=json.JSONDecoder(strict=False).decode(open(sys.argv[1]).read()); print(d.get(sys.argv[2],''))" "$1" "$2"; }

# 1. Model pick (informational — agent.json already pins claude-opus-4-8; confirm it's current)
if [ -z "${MODEL_CONFIRMED:-}" ]; then
  echo "Available models:"
  curl -sS "$BASE/models" "${H[@]:0:4}" -o /tmp/models.json
  python3 -c "import json; d=json.load(open('/tmp/models.json')); [print(m['id']) for m in d['data']]"
  echo "MODEL_CONFIRMED=1" >> IDS.env
fi

# 2. Environment
if [ -z "${ENV_ID:-}" ]; then
  echo "Creating environment..."
  curl -sS --fail-with-body "$BASE/environments" "${H[@]}" -d @environment.json -o /tmp/env.json
  ENV_ID=$(jparse /tmp/env.json id)
  echo "ENV_ID=$ENV_ID" >> IDS.env
  echo "✅ 📦 environment $ENV_ID"
else
  echo "✅ 📦 environment $ENV_ID (existing)"
fi

# 3. Agent
if [ -z "${AGENT_ID:-}" ]; then
  echo "Creating agent..."
  curl -sS --fail-with-body "$BASE/agents" "${H[@]}" -d @agent.json -o /tmp/agent.json
  AGENT_ID=$(jparse /tmp/agent.json id)
  AGENT_VERSION=$(jparse /tmp/agent.json version)
  echo "AGENT_ID=$AGENT_ID" >> IDS.env
  echo "AGENT_VERSION=$AGENT_VERSION" >> IDS.env
  echo "✅ 🤖 agent $AGENT_ID (v$AGENT_VERSION, claude-opus-4-8)"
else
  echo "✅ 🤖 agent $AGENT_ID (v${AGENT_VERSION:-1}, existing)"
fi

# 4. Upload the candidate-evidence file so the run can read it (Files API — check live docs if this 400s)
if [ -z "${CANDIDATE_FILE_ID:-}" ]; then
  echo "Uploading candidate-evidence file..."
  curl -sS --fail-with-body "$BASE/files" \
    -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
    -H "anthropic-beta: managed-agents-2026-04-01,files-api-2025-04-14" \
    -F "file=@synthetic-candidate-001-evidence.json" \
    -o /tmp/candidate_file.json
  CANDIDATE_FILE_ID=$(jparse /tmp/candidate_file.json id)
  echo "CANDIDATE_FILE_ID=$CANDIDATE_FILE_ID" >> IDS.env
  echo "✅ 📄 candidate-evidence file uploaded $CANDIDATE_FILE_ID"
else
  echo "✅ 📄 candidate-evidence file $CANDIDATE_FILE_ID (existing)"
fi

# 5. Session — attaches the uploaded file as a resource
if [ -z "${SESSION_ID:-}" ]; then
  echo "Creating session..."
  curl -sS --fail-with-body "$BASE/sessions" "${H[@]}" -d '{
    "agent": "'"$AGENT_ID"'",
    "environment_id": "'"$ENV_ID"'",
    "title": "case-01-lssm-tech-builder v1",
    "resources": [{"type": "file", "file_id": "'"$CANDIDATE_FILE_ID"'"}]
  }' -o /tmp/session.json
  SESSION_ID=$(jparse /tmp/session.json id)
  echo "SESSION_ID=$SESSION_ID" >> IDS.env
  echo "✅ ▶️ session $SESSION_ID (created, idle)"
else
  echo "✅ ▶️ session $SESSION_ID (existing)"
fi

# 5. Kickoff with the outcome event, only if not already sent
if [ -z "${KICKOFF_SENT:-}" ]; then
  echo "Sending outcome kickoff..."
  python3 -c "
import json
task = open('first_prompt.txt').read()
rubric = open('outcome.md').read()
evt = {'events':[{'type':'user.define_outcome','description':task,'rubric':{'type':'text','content':rubric},'max_iterations':3}]}
open('/tmp/kickoff.json','w').write(json.dumps(evt))
"
  curl -sS --fail-with-body "$BASE/sessions/$SESSION_ID/events" "${H[@]}" -d @/tmp/kickoff.json -o /tmp/kickoff_resp.json
  echo "KICKOFF_SENT=1" >> IDS.env
  echo "✅ ▶️ run started — session $SESSION_ID"
else
  echo "✅ ▶️ run already kicked off — session $SESSION_ID"
fi

echo
echo "Poll status:"
echo "  curl -sS \"$BASE/sessions/$SESSION_ID\" \"\${H[@]}\" -o /tmp/sess.json && python3 -c \"import json; d=json.JSONDecoder(strict=False).decode(open('/tmp/sess.json').read()); print(d['status'], [e.get('result') for e in d.get('outcome_evaluations',[])])\""
