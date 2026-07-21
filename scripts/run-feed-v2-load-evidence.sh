#!/usr/bin/env bash
set -euo pipefail

container="hirly-feed-v2-evidence-${$}"
port="${FEED_V2_EVIDENCE_PORT:-55435}"
database="hirly_feed_v2_evidence_${$}"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run --rm -d --name "$container" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB="$database" \
  -p "127.0.0.1:${port}:5432" postgres:15-alpine >/dev/null
for _ in $(seq 1 60); do
  docker exec "$container" pg_isready -U postgres -d "$database" >/dev/null 2>&1 && break
  sleep 0.5
done
sleep 1

output_path="$(python3 - "${1:-artifacts/candidate-matching/feed-v2-load-evidence.json}" <<'PY'
import os
import sys

print(os.path.abspath(sys.argv[1]))
PY
)"

url="postgres://postgres:postgres@127.0.0.1:${port}/${database}"
psql "$url" -v ON_ERROR_STOP=1 -f backend/db/migrations/20260721002400_candidate_matching_common_schema.sql >/dev/null
psql "$url" -v ON_ERROR_STOP=1 -f backend/db/migrations/20260721003000_feed_v2_active_recency_indexes.sql >/dev/null
FEED_V2_EVIDENCE_DATABASE_URL="$url" \
FEED_V2_EVIDENCE_GENERATED_AT="${FEED_V2_EVIDENCE_GENERATED_AT:-2026-07-21T08:00:00.000Z}" \
FEED_V2_EVIDENCE_BASELINE_CONCURRENCY="${FEED_V2_EVIDENCE_BASELINE_CONCURRENCY:-16}" \
bun run --cwd apps/feed-v2 evidence:load -- "$output_path"
