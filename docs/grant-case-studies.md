# IBCscan Grant Case Studies (Live Data)

Generated from live indexed artifacts at `2026-03-04T06:22:31Z`:
- `artifacts/case-studies/20260304T062231Z/grant-evidence.json`
- `artifacts/case-studies/20260304T062231Z/stuck-top30.json`
- `artifacts/case-studies/20260304T062231Z/live-linked-top30.json`

## Case Study 1: WBTC Transfer Stuck on Osmosis -> Noble Route

### Summary
A WBTC transfer from Osmosis to Noble is still unresolved after SLA and is flagged as `stuck` with source-chain verification.

### Incident Evidence
- Trace UI:
  - `https://ibc.188.40.64.104.sslip.io/trace/61D2186D5BE08CC4DB50087572688FDC3F1BFBDC786771F10E5478AC2EE0F53D?chain=osmosis-1`
- Trace API:
  - `https://api-ibc.188.40.64.104.sslip.io/v1/transfers/61D2186D5BE08CC4DB50087572688FDC3F1BFBDC786771F10E5478AC2EE0F53D?chain=osmosis-1`
- Packet identity:
  - `src_chain_id=osmosis-1`
  - `dst_chain_id=noble-1`
  - `src_channel=channel-208`
  - `dst_channel=channel-3`
  - `sequence=1667164`
  - `denom=transfer/channel-208/wbtc-satoshi`
  - `amount=185`
- Indexed status:
  - `status=stuck`
  - `verification_status=verified_unresolved_indexed_source`

### Verification Method
Source-chain terminal event checks (Osmosis RPC) for exact packet key:
- `acknowledge_packet` query total count: `0`
- `timeout_packet` query total count: `0`

Interpretation:
- Send was observed.
- No terminal packet (`ack`/`timeout`) observed on the source chain for this packet.
- Classification as stuck is supported by live chain event evidence.

### Operator Value
- Fast diagnosis: one request returns packet key + status.
- Eliminates manual channel/sequence reconstruction across explorers.

---

## Case Study 2: Large ATOM Transfer Stuck on Osmosis -> Cosmos Hub Route

### Summary
A high-value ATOM transfer from Osmosis to Cosmos Hub remains unresolved and is classified `stuck` with source verification.

### Incident Evidence
- Trace UI:
  - `https://ibc.188.40.64.104.sslip.io/trace/7B51AD73DE1A4CBA3D1A2E897EF012F75119B91ED207E67F12B5A974FCE65E58?chain=osmosis-1`
- Trace API:
  - `https://api-ibc.188.40.64.104.sslip.io/v1/transfers/7B51AD73DE1A4CBA3D1A2E897EF012F75119B91ED207E67F12B5A974FCE65E58?chain=osmosis-1`
- Packet identity:
  - `src_chain_id=osmosis-1`
  - `dst_chain_id=cosmoshub-4`
  - `src_channel=channel-0`
  - `dst_channel=channel-141`
  - `sequence=4504392`
  - `denom=transfer/channel-0/uatom`
  - `amount=933130000`
- Indexed status:
  - `status=stuck`
  - `verification_status=verified_unresolved_indexed_source`

### Verification Method
Source-chain terminal event checks (Osmosis RPC) for exact packet key:
- `acknowledge_packet` query total count: `0`
- `timeout_packet` query total count: `0`

Interpretation:
- Source `send_packet` exists.
- No completion terminal event observed yet.
- Stuck status is supported.

### Operator Value
- Gives concrete relayer investigation target: chain/channel/sequence.
- Directly actionable incident context for relay operators and support teams.

---

## Case Study 3: Live Multi-Hop Linked Trace (Packet Forwarding Pattern)

### Summary
A real transaction includes both `recv_packet` and `send_packet` in the same tx on an intermediate chain; IBCscan links them into one multi-hop trace.

### Incident Evidence
- Trace UI:
  - `https://ibc.188.40.64.104.sslip.io/trace/AE9FB84767ED1C5C4918A048DA2A2F7516BA1F1303A23906FD1C12489D39C096?chain=osmosis-1`
- Trace API:
  - `https://api-ibc.188.40.64.104.sslip.io/v1/transfers/AE9FB84767ED1C5C4918A048DA2A2F7516BA1F1303A23906FD1C12489D39C096?chain=osmosis-1`
- Linked transfer IDs:
  - `["5049441355549cd7a5a13f0e0c167f49", "bc0d535ea593883e85a0e87f2c377426"]`
- Hop evidence in same tx:
  - Hop A (`recv`): `channel-106313`, `sequence=4823`, `denom=ulume`
  - Hop B (`send`): `channel-0`, `sequence=4504499`, `denom=transfer/channel-0/uatom`
  - Both emitted in tx `AE9FB847...`

### Interpretation
- This demonstrates real cross-hop stitching (not mocked data).
- It validates the project’s core value proposition: one query returns the connected flow rather than isolated packet events.

### Operator Value
- Better user support for routed transfers.
- Faster pinpointing of failing leg in multi-hop paths.

---

## Current Evidence Snapshot (For Grant Application)

From `GET /v1/status/grant-evidence`:
- `top5_coverage_ready=true`
- `stuck_verification_breakdown`:
  - `verified_unresolved_indexed_source=58`
  - `unverifiable_unknown_source=17`
  - `unverifiable_source_not_indexed=2`
- `unknown_attribution_24h`:
  - `unknown_src_ratio=0.2367`
  - `unknown_dst_ratio=0.1531`

## Gaps and Follow-Up

1. Reduce `unknown_*` attribution by expanding chain coverage and channel mapping refresh jobs.
2. Add periodic source-chain terminal-event verification persistence per stuck row.
3. Publish these case studies with timestamps and immutable JSON artifacts in the grant appendix.
