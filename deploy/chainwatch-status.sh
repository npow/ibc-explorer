#!/usr/bin/env bash
set -euo pipefail

HOST="${1:-chainwatch}"
API_BASE="${2:-https://api-ibc.188.40.64.104.sslip.io}"

echo "== API grant readiness =="
curl -fsSL "${API_BASE}/v1/status/grant-readiness" | jq .
echo

echo "== DB: required chain cursors =="
ssh "root@${HOST}" "docker exec ibc-explorer-db psql -U ibc -d ibc_explorer -Atc \"SELECT chain_id, last_height, to_char(updated_at,'YYYY-MM-DD HH24:MI:SS') FROM indexer_cursors WHERE chain_id IN ('cosmoshub-4','osmosis-1','neutron-1','injective-1','stride-1') ORDER BY chain_id;\""
echo

echo "== DB: packet events in last 60 minutes =="
ssh "root@${HOST}" "docker exec ibc-explorer-db psql -U ibc -d ibc_explorer -Atc \"SELECT chain_id, COUNT(*) FROM ibc_packets WHERE block_time > NOW() - INTERVAL '60 minutes' GROUP BY chain_id ORDER BY 2 DESC;\""
echo

echo "== DB: multi-hop links =="
ssh "root@${HOST}" "docker exec ibc-explorer-db psql -U ibc -d ibc_explorer -Atc \"SELECT COUNT(*) FROM transfer_links;\""
echo

echo "== DB: latest linked tx candidates =="
ssh "root@${HOST}" "docker exec ibc-explorer-db psql -U ibc -d ibc_explorer -Atc \"WITH linked AS (SELECT from_transfer_id AS transfer_id FROM transfer_links UNION SELECT to_transfer_id AS transfer_id FROM transfer_links) SELECT chain_id, tx_hash, COUNT(DISTINCT transfer_id) AS linked_transfers, MAX(block_time) AS last_seen FROM transfer_events WHERE transfer_id IN (SELECT transfer_id FROM linked) GROUP BY chain_id, tx_hash HAVING COUNT(DISTINCT transfer_id) > 1 ORDER BY last_seen DESC LIMIT 10;\""
