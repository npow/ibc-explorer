# ibc-explorer

[![CI](https://github.com/npow/ibc-explorer/actions/workflows/ci.yml/badge.svg)](https://github.com/npow/ibc-explorer/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

Trace any IBC transfer across Cosmos chains in seconds — and find exactly where it got stuck.

## The problem

When a token moves across three or more Cosmos chains via IBC, no existing tool shows you the complete journey. IBC denom hashes are opaque without a live RPC query, and packet state is stored per-chain with nothing stitching it together. When a transfer silently fails, you're left running raw CLI queries across multiple chains to figure out what happened.

## Quick start

```bash
# Decode any IBC denom hash
curl "https://api.ibcscan.io/v1/denoms/decode?denom=ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2&chain=osmosis-1"

# Trace a full multi-hop transfer
curl "https://api.ibcscan.io/v1/transfers/ABC123...?chain=cosmoshub-4"
```

## Usage

**Decode an IBC denom hash to its origin chain and path:**

```bash
GET /v1/denoms/decode?denom=ibc/HASH&chain=osmosis-1
# → { path: "transfer/channel-0", base_denom: "uatom", origin_chain_id: "cosmoshub-4", hops: [...] }
```

**Trace a transfer across chains:**

```bash
GET /v1/transfers/{tx_hash}?chain=cosmoshub-4
# → { status: "stuck", hops: [...], last_known_chain: "osmosis-1", stuck_since: "..." }
```

**Get channel health between two chains:**

```bash
GET /v1/channels?src_chain=osmosis-1&dst_chain=cosmoshub-4
# → { channels: [{ status: "healthy", p99_latency_ms: 95000, error_rate_24h: 0.0012 }] }
```

## How it works

IBCscan runs a per-chain indexer on each Cosmos chain that streams IBC packet events in real time. A cross-chain packet stitcher links `send_packet` events on one chain to `recv_packet` and `acknowledge_packet` events on another by correlating sequence numbers and channel counterparties. IBC denom hashes are resolved once via the chain's LCD API and cached permanently — no live RPC in the query path.

See [PRD.md](PRD.md) for the full architecture and data model.

## Development

```bash
# Install dependencies
npm install

# Run the denom decoder locally
npm run dev --workspace=packages/denom-decoder

# Run the Osmosis indexer
npm run dev --workspace=packages/indexer

# Run tests
npm test
```

See [memory/demos.md](.claude/projects/-root-code-ibc-explorer/memory/demos.md) for the implementation plan for each component.

## License

Apache 2.0 — see [LICENSE](LICENSE)
