#!/usr/bin/env bash
set -euo pipefail

server_url="${NUDGE_SERVER_URL:-http://127.0.0.1:8000}"
payload='{"task":"Open the application tracker","context":{"schemaVersion":"1.0","source":"nudge-extension","page":{"urlOrigin":"https://demo.sevasetu.gov.in","title":"SevaSetu demo","elements":[{"id":"el_0001","role":"button","name":"Open application tracker","state":{"enabled":true,"visible":true}}],"redactions":{"count":0,"types":[]}}}}'

curl --silent --show-error --output /dev/null --write-out 'reasoning_request_seconds=%{time_total}\nhttp_status=%{http_code}\n' \
  --header 'Content-Type: application/json' \
  --data "$payload" \
  "$server_url/v1/next-action"
