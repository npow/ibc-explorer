#!/usr/bin/env bash
set -euo pipefail

API_BASE="${1:-https://api-ibc.188.40.64.104.sslip.io}"
OUT_DIR="${2:-./artifacts/case-studies}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="${OUT_DIR}/${STAMP}"

mkdir -p "${RUN_DIR}"

echo "Writing case-study candidates to ${RUN_DIR}"

curl -fsSL "${API_BASE}/v1/status/grant-evidence" \
  | jq . > "${RUN_DIR}/grant-evidence.json"

curl -fsSL "${API_BASE}/v1/transfers/stuck?limit=30" \
  | jq . > "${RUN_DIR}/stuck-top30.json"

curl -fsSL "${API_BASE}/v1/transfers/live-linked?page=1&limit=30" \
  | jq . > "${RUN_DIR}/live-linked-top30.json"

jq -r '.items[] | select(.tx_hash != null) | "\(.chain_id) \(.tx_hash)"' "${RUN_DIR}/stuck-top30.json" \
  | head -n 10 \
  | while read -r chain tx; do
      curl -fsSL "${API_BASE}/v1/transfers/${tx}?chain=${chain}" \
        | jq . > "${RUN_DIR}/trace-stuck-${chain}-${tx}.json" || true
    done

jq -r '.items[] | "\(.chain_id) \(.tx_hash)"' "${RUN_DIR}/live-linked-top30.json" \
  | head -n 10 \
  | while read -r chain tx; do
      curl -fsSL "${API_BASE}/v1/transfers/${tx}?chain=${chain}" \
        | jq . > "${RUN_DIR}/trace-linked-${chain}-${tx}.json" || true
    done

echo "Done."
