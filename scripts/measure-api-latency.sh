#!/usr/bin/env bash
set -euo pipefail

server_url="${NUDGE_SERVER_URL:-http://127.0.0.1:8000}"
run_count="${NUDGE_MEASURE_RUNS:-5}"
if ! [[ "$run_count" =~ ^[1-9][0-9]*$ ]]; then
  echo "NUDGE_MEASURE_RUNS must be a positive integer." >&2
  exit 2
fi
payload='{"task":"Open the application tracker","context":{"schemaVersion":"1.0","source":"nudge-extension","page":{"urlOrigin":"https://demo.sevasetu.gov.in","title":"SevaSetu demo","elements":[{"id":"el_0001","role":"button","name":"Open application tracker","state":{"enabled":true,"visible":true}}],"redactions":{"count":0,"types":[]}}},"redactionManifest":{"count":0,"types":[],"visualMaskCount":0,"renderer":"local-canvas-dom-v1"}}'

samples=()
for ((run = 1; run <= run_count; run += 1)); do
  # The body is discarded. Timing/status are the only values emitted, so an
  # accidental provider response cannot enter a benchmark log.
  result="$(curl --silent --show-error --output /dev/null --write-out '%{http_code} %{time_total}' \
    --header 'Content-Type: application/json' \
    --data "$payload" \
    "$server_url/v1/next-action")"
  read -r status seconds <<<"$result"
  if ! [[ "$status" =~ ^2[0-9][0-9]$ ]] || ! [[ "$seconds" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    echo "API measurement failed on run $run (HTTP ${status:-unknown})." >&2
    exit 1
  fi
  samples+=("$seconds")
  printf 'run=%d reasoning_request_seconds=%s http_status=%s\n' "$run" "$seconds" "$status"
done

sorted="$(printf '%s\n' "${samples[@]}" | sort -n)"
median="$(awk '{values[NR]=$1} END { if (NR % 2) print values[(NR + 1) / 2]; else printf "%.6f", (values[NR / 2] + values[NR / 2 + 1]) / 2 }' <<<"$sorted")"
p95_index=$(( (95 * run_count + 99) / 100 ))
p95="$(sed -n "${p95_index}p" <<<"$sorted")"
printf 'runs=%d reasoning_request_median_seconds=%s reasoning_request_p95_seconds=%s\n' "$run_count" "$median" "$p95"
