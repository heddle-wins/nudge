#!/usr/bin/env bash
set -euo pipefail

# Avoid stopping a demonstrator's already-running stack when this check runs.
if docker compose ps --status running --services | rg --quiet '.'; then
  echo 'Compose demo is already running; stop it before running this smoke check.' >&2
  exit 2
fi

cleanup() {
  docker compose down --remove-orphans
}
trap cleanup EXIT

# The smoke test is deterministic and never reads a provider key from the
# caller's environment.
NUDGE_PROVIDER=mock NUDGE_MODEL=gpt-5-mini docker compose up --build --detach

for attempt in {1..15}; do
  if curl --fail --silent --show-error http://127.0.0.1:8000/healthz \
    | rg --quiet '"status":"ok".*"provider":"mock"'; then
    break
  fi
  if [[ "$attempt" == 15 ]]; then
    echo 'Reasoning API did not become healthy.' >&2
    exit 1
  fi
  sleep 1
done

NUDGE_SERVER_URL=http://127.0.0.1:8000 NUDGE_MEASURE_RUNS=1 \
  bash scripts/measure-api-latency.sh
curl --fail --silent --show-error http://127.0.0.1:4173/ \
  | rg --quiet '<title>SevaSetu'

echo 'Compose demo smoke check passed.'
