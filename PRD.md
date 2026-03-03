# Spec: IBCscan — Unified IBC Transfer Tracker & Explorer
**Status:** Draft
**Date:** 2026-03-03
**Author:** Claude

---

## Problem Statement

When a token moves across three or more Cosmos chains via the Inter-Blockchain Communication (IBC) protocol, no existing tool provides a complete, human-readable view of its journey. Mintscan covers individual chains with IBC overviews, and MapOfZones visualizes aggregate flows — but neither can answer the question a developer or user actually has: "I sent ATOM from Cosmos Hub, it went through Osmosis and Neutron, and never arrived at Injective — where is it stuck and why?" The underlying technical reason is that IBC denom hashes (e.g., `ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2`) are opaque without a `denomtrace` query against a live node, and packet state transitions are stored per-chain with no cross-chain stitching layer. The cost of this gap is measurable: relayer operators manually debug stuck packets using raw CLI queries, DeFi protocols lose user trust when deposits silently fail, and new appchain teams spend days diagnosing transfer failures that a purpose-built indexer could surface in milliseconds. IBCscan solves this by maintaining a persistent, cross-chain packet state machine that assembles the complete A→B→C→D transfer graph with decoded denoms, timing, acknowledgement status, and failure attribution.

---

## Goals

- A user can input any transaction hash or IBC packet sequence number and see the complete multi-hop transfer trace (all hops, decoded denoms, per-hop timing, final status) in under 2 seconds.
- Stuck packet detection fires within 5 minutes of a configurable SLA breach (default: packet sent but not acknowledged within 30 minutes).
- The denom decoder resolves any IBC denom hash to its original base denom and full hop path in < 500ms for any denom previously seen by the indexer, with a fallback live-query path for unknown denoms.
- The developer API sustains 10,000 requests/day on the free tier with p99 latency < 300ms at up to 100 concurrent connections.
- At least 3 Cosmos ecosystem teams (e.g., relayer operators, DeFi protocols, appchain DevRel teams) are active API users within 90 days of public launch.

---

## Non-Goals

- **EVM chain support.** IBCscan indexes Cosmos SDK chains connected via IBC only. Ethereum bridging protocols (Axelar EVM routes, Wormhole, LayerZero) are out of scope for v1.
- **Non-IBC cross-chain transfers.** Gravity Bridge, Nomic, and other non-ICS-20 transfer mechanisms are not tracked.
- **Wallet or portfolio features.** IBCscan is a developer and power-user tool; it does not manage private keys, display portfolio values, or execute transactions.
- **Governance and staking analytics.** Chain-level governance, validator metrics, and staking data are not indexed. Mintscan already covers these well.
- **Real-time mempool / pre-confirmation tracking.** IBCscan tracks confirmed on-chain packet events only; pending mempool state is not indexed.
- **Alerting via SMS or phone call.** Alert delivery in v1 is webhook and email only.

---

## Background and Context

IBC is the Cosmos ecosystem's native cross-chain messaging protocol. An ICS-20 token transfer works as a packet state machine: a `send_packet` event is emitted on the source chain, a relayer submits a `recv_packet` on the destination chain, and an `acknowledge_packet` or `timeout_packet` completes the cycle. For a multi-hop transfer (source → intermediate → destination), each hop is an independent packet state machine, linked only by the fact that the token's IBC denom on the intermediate chain encodes the path it arrived on.

The denom encoding scheme is the root of the opacity problem. A denom like `ibc/HASH` is the SHA-256 of `path/base_denom`, where `path` is a slash-delimited list of `transfer/{channel_id}` segments. This means a denom that traveled through three chains has a path like `transfer/channel-141/transfer/channel-208/uatom`, and the hash reveals nothing without a `denomtrace` RPC call to a live node on the chain holding that denom. No existing explorer maintains a persistent denomtrace cache keyed by hash across all chains.

Existing tools and their gaps:
- **Mintscan** (Cosmostation): Full single-chain explorer for 63+ chains with IBC overviews. Does not stitch multi-hop journeys across chains; shows IBC volume in aggregate but not per-transfer traces.
- **MapOfZones**: Excellent macro visualization of IBC flow volumes across 90+ chains. Visual-only; no per-transfer query, no denom decoding, no developer API.
- **IOBScan**: Per-packet search with channel info. Single-hop only; no multi-hop stitching; limited chain coverage (~12 chains).
- **Chain Pulse / Hermes metrics**: Relayer-operator tooling for Prometheus metrics on relayed packets. No end-user query interface.

IBCscan's technical differentiation is a **cross-chain packet stitcher** — a service that, given a packet on chain A, traverses the denom path encoded in the transferred token to reconstruct the full journey and link it to downstream packets by correlating receiver addresses, amounts, and forward memo fields.

---

## Design

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        IBCscan Platform                      │
│                                                              │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────┐ │
│  │  Chain       │   │  Packet      │   │  Denom          │ │
│  │  Indexers    │──▶│  Stitcher    │──▶│  Resolver       │ │
│  │  (per chain) │   │  (cross-     │   │  (hash cache +  │ │
│  └──────────────┘   │   chain)     │   │   live fallback)│ │
│         │           └──────┬───────┘   └─────────────────┘ │
│         │                  │                                 │
│         ▼                  ▼                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              TimescaleDB / PostgreSQL                 │   │
│  │  (packets, transfers, channels, denoms, alerts)       │   │
│  └──────────────────────────────────────────────────────┘   │
│                            │                                 │
│         ┌──────────────────┼──────────────┐                 │
│         ▼                  ▼              ▼                 │
│  ┌────────────┐   ┌──────────────┐  ┌──────────────┐       │
│  │  REST API  │   │  WebSocket   │  │  Alert       │       │
│  │  (Fastify) │   │  (Socket.IO) │  │  Dispatcher  │       │
│  └────────────┘   └──────────────┘  └──────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### API / Interface

#### REST API — Base URL: `https://api.ibcscan.io/v1`

**1. Resolve a multi-hop transfer from a source tx hash**
```http
GET /transfers/{tx_hash}?chain={chain_id}

Response 200:
{
  "transfer_id": "cosmos:cosmoshub-4:abc123...",
  "status": "completed" | "pending" | "stuck" | "timeout" | "refunded",
  "source": {
    "chain_id": "cosmoshub-4",
    "tx_hash": "ABC123...",
    "sender": "cosmos1...",
    "block_height": 18500000,
    "timestamp": "2026-01-15T10:23:00Z"
  },
  "destination": {
    "chain_id": "injective-1",
    "tx_hash": "DEF456...",
    "receiver": "inj1...",
    "block_height": 56200000,
    "timestamp": "2026-01-15T10:24:12Z"
  },
  "hops": [
    {
      "hop_index": 0,
      "src_chain_id": "cosmoshub-4",
      "dst_chain_id": "osmosis-1",
      "src_channel_id": "channel-141",
      "dst_channel_id": "channel-0",
      "packet_sequence": 4821943,
      "send_tx": "ABC123...",
      "recv_tx": "XYZ789...",
      "ack_tx": "QRS456...",
      "status": "acknowledged",
      "send_at": "2026-01-15T10:23:00Z",
      "recv_at": "2026-01-15T10:23:28Z",
      "ack_at":  "2026-01-15T10:23:41Z",
      "latency_ms": 41000
    },
    {
      "hop_index": 1,
      "src_chain_id": "osmosis-1",
      "dst_chain_id": "neutron-1",
      ...
    },
    {
      "hop_index": 2,
      "src_chain_id": "neutron-1",
      "dst_chain_id": "injective-1",
      ...
    }
  ],
  "token": {
    "amount": "1000000",
    "src_denom": "uatom",
    "dst_denom": "ibc/C4CFF46FD6DE35CA4CF4CE031E643C8FDC9BA4B99AE598E9B0ED98FE3A2319F9",
    "dst_denom_decoded": {
      "path": "transfer/channel-141/transfer/channel-0/transfer/channel-8",
      "base_denom": "uatom",
      "origin_chain": "cosmoshub-4"
    }
  },
  "forward_memo": null
}
```

**2. Decode an IBC denom hash**
```http
GET /denoms/decode?denom=ibc%2F27394FB092D...&chain={chain_id}

Response 200:
{
  "denom": "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
  "chain_id": "osmosis-1",
  "path": "transfer/channel-0",
  "base_denom": "uatom",
  "origin_chain_id": "cosmoshub-4",
  "hops": [
    { "chain_id": "cosmoshub-4", "channel": "channel-141" },
    { "chain_id": "osmosis-1",   "channel": "channel-0"   }
  ],
  "resolved_from": "cache" | "live_node",
  "cached_at": "2026-01-10T08:00:00Z"
}
```

**3. List and search transfers for an address**
```http
GET /addresses/{bech32_address}/transfers
  ?chain={chain_id}          // filter: only show when address is on this chain
  &status=stuck              // filter: completed | pending | stuck | timeout
  &limit=20&cursor={cursor}  // pagination

Response 200:
{
  "transfers": [ ...Transfer[] ],
  "next_cursor": "eyJ...",
  "total": 1482
}
```

**4. Channel health dashboard**
```http
GET /channels
  ?src_chain={chain_id}
  &dst_chain={chain_id}
  &status=degraded           // healthy | degraded | inactive
  &limit=50&cursor={cursor}

Response 200:
{
  "channels": [
    {
      "src_chain_id": "osmosis-1",
      "dst_chain_id": "cosmoshub-4",
      "src_channel_id": "channel-0",
      "dst_channel_id": "channel-141",
      "status": "healthy",
      "counterparty_status": "healthy",
      "relayers": ["cosmos1relayer1...", "cosmos1relayer2..."],
      "packets_24h": 18200,
      "pending_packets": 3,
      "p50_latency_ms": 28000,
      "p99_latency_ms": 95000,
      "error_rate_24h": 0.0012,
      "last_packet_at": "2026-03-03T14:22:00Z"
    }
  ],
  "next_cursor": "eyJ..."
}
```

**5. Packet-level query by sequence**
```http
GET /packets/{chain_id}/{channel_id}/{sequence}

Response 200:
{
  "chain_id": "osmosis-1",
  "channel_id": "channel-0",
  "sequence": 4821943,
  "direction": "send" | "recv",
  "status": "acknowledged",
  "send_tx": "...",
  "recv_tx": "...",
  "ack_tx": "...",
  "data": { ...decoded ICS-20 FungibleTokenPacketData },
  "transfer_id": "cosmos:cosmoshub-4:abc123..."  // link to parent transfer
}
```

**6. Alert management**
```http
POST /alerts
Content-Type: application/json
Authorization: Bearer {api_key}
{
  "name": "My Relayer SLA Monitor",
  "type": "stuck_packet",
  "filters": {
    "src_chain_id": "osmosis-1",       // optional: scope to specific chain pair
    "dst_chain_id": "cosmoshub-4",     // optional
    "channel_id": "channel-0"          // optional
  },
  "sla_minutes": 30,                   // alert if no ack within this window
  "delivery": {
    "webhook_url": "https://...",
    "email": "ops@example.com"
  }
}

Response 201:
{ "alert_id": "alrt_abc123", "status": "active" }

GET  /alerts                   // list all alerts for API key
DELETE /alerts/{alert_id}      // delete alert
```

#### WebSocket API — `wss://ws.ibcscan.io/v1`

```javascript
// Connect and authenticate
const ws = new WebSocket("wss://ws.ibcscan.io/v1");
ws.send(JSON.stringify({ type: "auth", api_key: "sk_..." }));

// Subscribe to all IBC packet events for a chain pair
ws.send(JSON.stringify({
  type: "subscribe",
  channel: "packets",
  filters: {
    src_chain_id: "osmosis-1",
    dst_chain_id: "cosmoshub-4"
  }
}));

// Subscribe to stuck transfer alerts for an API key
ws.send(JSON.stringify({
  type: "subscribe",
  channel: "alerts"
}));

// Incoming event shape
{
  "type": "packet_event",
  "event": "send" | "recv" | "ack" | "timeout",
  "packet": { ...Packet },
  "transfer_id": "...",         // present if stitched to a known transfer
  "timestamp": "2026-03-03T..."
}

{
  "type": "alert_fired",
  "alert_id": "alrt_abc123",
  "transfer_id": "...",
  "stuck_since": "2026-03-03T10:00:00Z",
  "last_seen_chain": "osmosis-1",
  "last_seen_channel": "channel-0"
}
```

---

### Data Model

```sql
-- Core packet event log (one row per on-chain IBC event)
CREATE TABLE ibc_packets (
  id              BIGSERIAL PRIMARY KEY,
  chain_id        TEXT NOT NULL,
  channel_id      TEXT NOT NULL,       -- local channel (e.g., "channel-0")
  sequence        BIGINT NOT NULL,
  direction       TEXT NOT NULL,       -- 'send' | 'recv' | 'ack' | 'timeout'
  tx_hash         TEXT NOT NULL,
  block_height    BIGINT NOT NULL,
  block_time      TIMESTAMPTZ NOT NULL,
  src_chain_id    TEXT NOT NULL,       -- from channel counterparty
  dst_chain_id    TEXT NOT NULL,
  src_channel_id  TEXT NOT NULL,
  dst_channel_id  TEXT NOT NULL,
  sender          TEXT,
  receiver        TEXT,
  denom           TEXT NOT NULL,       -- raw denom as it appears on this chain
  amount          NUMERIC NOT NULL,
  memo            TEXT,
  ack_success     BOOLEAN,             -- NULL until ack received
  transfer_id     TEXT,                -- FK to ibc_transfers after stitching
  UNIQUE (chain_id, channel_id, sequence, direction)
);

-- Stitched multi-hop transfer (assembled by packet stitcher)
CREATE TABLE ibc_transfers (
  id              TEXT PRIMARY KEY,    -- "cosmos:{src_chain}:{src_tx_hash}"
  status          TEXT NOT NULL,       -- 'pending'|'completed'|'stuck'|'timeout'|'refunded'
  src_chain_id    TEXT NOT NULL,
  src_tx_hash     TEXT NOT NULL,
  src_sender      TEXT NOT NULL,
  dst_chain_id    TEXT,                -- NULL until final hop acked
  dst_tx_hash     TEXT,
  dst_receiver    TEXT,
  src_denom       TEXT NOT NULL,
  src_amount      NUMERIC NOT NULL,
  dst_denom       TEXT,                -- final denom on destination chain
  hop_count       INT NOT NULL DEFAULT 1,
  started_at      TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ,
  stuck_since     TIMESTAMPTZ,         -- set when SLA breach detected
  last_known_chain TEXT,
  last_known_channel TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- IBC denom cache (denomtrace resolved across all chains)
CREATE TABLE ibc_denoms (
  chain_id        TEXT NOT NULL,
  denom_hash      TEXT NOT NULL,        -- e.g., "ibc/27394FB..."
  full_denom      TEXT NOT NULL,        -- "transfer/channel-0/uatom"
  base_denom      TEXT NOT NULL,        -- "uatom"
  origin_chain_id TEXT NOT NULL,
  hop_path        JSONB NOT NULL,       -- [{"chain":"cosmoshub-4","channel":"channel-141"}, ...]
  resolved_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (chain_id, denom_hash)
);

-- Channel registry with health metrics (updated every 5 minutes)
CREATE TABLE ibc_channels (
  src_chain_id      TEXT NOT NULL,
  src_channel_id    TEXT NOT NULL,
  dst_chain_id      TEXT NOT NULL,
  dst_channel_id    TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'healthy',
  relayer_addresses TEXT[],
  packets_1h        INT DEFAULT 0,
  packets_24h       INT DEFAULT 0,
  pending_packets   INT DEFAULT 0,
  p50_latency_ms    INT,
  p99_latency_ms    INT,
  error_rate_24h    FLOAT,
  last_packet_at    TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (src_chain_id, src_channel_id)
);

-- Alert configurations (per API key)
CREATE TABLE alert_configs (
  id              TEXT PRIMARY KEY,
  api_key_hash    TEXT NOT NULL,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,        -- 'stuck_packet' (v1 only)
  src_chain_id    TEXT,                 -- NULL = all chains
  dst_chain_id    TEXT,
  channel_id      TEXT,
  sla_minutes     INT NOT NULL DEFAULT 30,
  webhook_url     TEXT,
  email           TEXT,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fired alert log
CREATE TABLE alert_events (
  id              BIGSERIAL PRIMARY KEY,
  alert_config_id TEXT NOT NULL REFERENCES alert_configs(id),
  transfer_id     TEXT NOT NULL,
  fired_at        TIMESTAMPTZ NOT NULL,
  resolved_at     TIMESTAMPTZ,
  delivery_status TEXT NOT NULL        -- 'delivered' | 'failed' | 'pending'
);
```

**TypeScript interface shapes for API clients:**

```typescript
interface Transfer {
  transfer_id: string;
  status: "completed" | "pending" | "stuck" | "timeout" | "refunded";
  source: TransferEndpoint;
  destination: TransferEndpoint | null;
  hops: Hop[];
  token: TransferToken;
  forward_memo: string | null;
}

interface Hop {
  hop_index: number;
  src_chain_id: string;
  dst_chain_id: string;
  src_channel_id: string;
  dst_channel_id: string;
  packet_sequence: number;
  send_tx: string;
  recv_tx: string | null;
  ack_tx: string | null;
  status: "acknowledged" | "pending_recv" | "pending_ack" | "timeout";
  send_at: string;        // ISO 8601
  recv_at: string | null;
  ack_at: string | null;
  latency_ms: number | null;
}

interface DecodedDenom {
  denom: string;
  chain_id: string;
  path: string;
  base_denom: string;
  origin_chain_id: string;
  hops: Array<{ chain_id: string; channel: string }>;
  resolved_from: "cache" | "live_node";
  cached_at: string;
}
```

---

### Workflow / Sequence

**Indexing pipeline (per chain, continuous):**
```
1. Chain Indexer subscribes to Tendermint WebSocket (event_type = "message")
   filtered on action = "/ibc.core.channel.v1.MsgRecvPacket" etc.
2. On each block, indexer fetches full tx results for IBC-tagged txs via RPC
3. Parses send_packet / recv_packet / acknowledge_packet / timeout events
4. Decodes ICS-20 FungibleTokenPacketData from packet.data (base64 protobuf)
5. Writes raw ibc_packets row to TimescaleDB
6. Publishes packet event to internal message queue (Redis Streams)
```

**Packet stitcher (consumes message queue):**
```
1. Receives new packet event from queue
2. For 'send_packet' events:
   a. Creates ibc_transfers row with status='pending', hop_count=1
   b. Starts SLA timer (configurable, default 30min)
3. For 'recv_packet' events:
   a. Looks up matching 'send_packet' by (dst_chain, dst_channel, sequence)
   b. If found: updates transfer, increments hop_count if forwarded via memo
   c. If packet contains ICS-20 forward memo: creates expectation for next hop
4. For 'acknowledge_packet' events:
   a. Looks up transfer, sets status='completed', records completed_at
5. For 'timeout_packet' events:
   a. Sets status='timeout'; if refund tx follows, sets status='refunded'
6. Every 1 minute: scans pending transfers older than SLA threshold,
   sets status='stuck', writes alert_events row
```

**Denom resolution:**
```
1. On recv_packet: extract denom from packet data
2. If denom starts with "ibc/": check ibc_denoms cache (chain_id, denom_hash)
3. Cache HIT: return cached denomtrace, skip RPC
4. Cache MISS:
   a. Call chain RPC: GET /ibc/apps/transfer/v1/denom_traces/{hash}
   b. Parse path segments into hop array
   c. Insert into ibc_denoms cache
   d. If path is multi-hop, recursively resolve upstream chain denoms
5. Store fully decoded hop_path as JSONB for instant future lookups
```

**Transfer query (API request path):**
```
1. Client calls GET /transfers/{tx_hash}?chain=cosmoshub-4
2. API looks up ibc_packets WHERE tx_hash = ? AND chain_id = ?
3. Fetches linked ibc_transfers row via transfer_id
4. Fetches all ibc_packets WHERE transfer_id = ? ORDER BY hop_index
5. For each hop: resolves denoms from cache (no live RPC in hot path)
6. Assembles Transfer response shape, returns in < 2s
```

---

### Key Design Decisions

| Decision | Options Considered | Chosen | Rationale |
|---|---|---|---|
| Chain indexing model | Push (WebSocket subscribe) vs Pull (block polling) | WebSocket with polling fallback | WS misses events on reconnect; polling fallback ensures no gaps; WS preferred for latency |
| Packet stitching trigger | Real-time (on recv) vs batch (cron) | Real-time via Redis Streams | Batch introduces up to minutes of lag for stuck detection; real-time enables sub-minute alerting |
| Denom resolution timing | Eager (on send) vs Lazy (on query) | Eager on recv_packet | Most queries are for completed transfers; eager populates cache before queries arrive |
| Multi-hop linking mechanism | Memo-based (ICS-20 forward memo) + address correlation | Both, with memo preferred | Not all multi-hop transfers use memo forwarding; address correlation catches manual multi-hop |
| Database | PostgreSQL, TimescaleDB, ClickHouse | TimescaleDB (PostgreSQL extension) | Time-series compression for block_time partitions; full SQL compatibility; avoids ClickHouse operational complexity at small scale |
| Chain coverage launch set | All 90 IBC chains vs curated top-20 | Curated top-20 by IBC volume | Indexing all 90 chains on day 1 requires ~40 full nodes; top-20 covers >95% of IBC packet volume; expand iteratively |
| API auth | API key vs JWT vs OAuth | API key | Simplest for developer tool; no OAuth server to operate; keys are scoped and rotatable |
| Open source strategy | Fully closed vs fully open vs open core | Open core (indexer open, API + alerting closed) | Open indexer enables chain grants and community trust; closed API tier is the monetization layer |

---

## Failure Modes

| Failure | Probability | Impact | Mitigation |
|---|---|---|---|
| Chain RPC node goes offline | High (some chains) | Medium | Each chain has 2 redundant RPC endpoints; automatic failover; alert fires if chain indexer falls >100 blocks behind |
| Packet stitcher misses a recv_packet during restart | Medium | High | Redis Streams provides at-least-once delivery with consumer group ACKs; idempotent upserts on all writes |
| IBC denom RPC returns stale / incorrect denomtrace | Low | High | Cross-validate decoded path against channel registry; flag mismatches for manual review; re-query after 24h |
| Multi-hop transfer uses non-standard forward mechanism | Medium | Medium | Fallback: address-correlation heuristic links hops by (sender ≈ intermediate chain escrow, receiver, amount); mark as "inferred" in response |
| False positive "stuck" alert (relayer slow but not dead) | Medium | Low | Default SLA window is 30 minutes (covers p99.9 relay latency); users can tune per-alert; auto-resolve when ack arrives |
| Database growth (10+ chains × 1M packets/day) | High (long-term) | Medium | TimescaleDB time partitioning with 90-day retention on raw packets; transfer-level summaries retained indefinitely; archive to S3 Parquet for old data |
| Single chain indexer falls behind during high traffic | Medium | Medium | Per-chain backpressure detection; scale indexer horizontally via chain_id sharding; priority queue for high-volume chains |
| API key abuse (free tier scraping) | Medium | Low | Rate limiting at API gateway (10K req/day free, 429 with Retry-After); graduated throttle before hard cutoff |
| Accidental channel proliferation confuses stitcher | Low | Medium | Channel registry validated against IBC on-chain channel state at startup; orphan channels (0 packets in 30 days) excluded from indexing |
| Chain upgrade changes packet format (protobuf schema) | Low | High | Pin proto definitions per chain with chain-upgrade detection; pause indexer and alert ops team when unexpected packet decode fails |

---

## Success Metrics

**Product:**
- Multi-hop transfer trace query returns complete result in p50 < 800ms, p99 < 2000ms under 100 concurrent users at launch.
- Denom decoder resolves any previously-seen denom hash in p99 < 100ms (cache path).
- Stuck transfer alerts fire within 5 minutes of SLA breach for 99%+ of triggered conditions.
- Zero false-negative stuck alerts in first 30 days (every stuck packet fires; no silent drops).

**Adoption:**
- 3 external developer teams (relayer operators, DeFi protocols, or appchain DevRel) using the API within 90 days of public launch.
- 500 unique API keys issued within 6 months.
- At least 1 Cosmos ecosystem grant application submitted within 30 days of MVP completion (Osmosis, Interchain Foundation, or Neutron Foundation).

**Business:**
- At least 2 paying API customers (Growth or Pro tier) within 6 months.
- At least 1 white-label appchain explorer contract signed within 12 months.
- Infrastructure cost per indexed chain < $300/month at steady state (full node amortized + compute).

**Quality:**
- Indexer lag < 2 blocks behind chain head for all indexed chains, measured as p95 over 30-day rolling window.
- Packet stitching accuracy >= 99% for standard ICS-20 transfers (validated against manual Mintscan spot-checks on 1,000 sampled transfers).

---

## Phased Rollout

### Phase 1 — MVP (Weeks 1–8): Indexer + Denom Decoder
- Index top-5 chains by IBC volume: Cosmos Hub, Osmosis, Neutron, Injective, Stride
- Working multi-hop trace for any tx hash on these chains
- IBC denom decoder with persistent cache
- Read-only REST API (no auth, rate-limited by IP)
- Minimal web UI: search box → transfer trace view

### Phase 2 — Developer Platform (Weeks 9–16): Auth + Alerts + Channel Health
- API key issuance and free/growth/pro tiers
- Stuck transfer detection and webhook/email alerting
- Channel health dashboard (all channels between indexed chains)
- Expand to top-20 chains by IBC volume
- WebSocket streaming for packet events

### Phase 3 — White-Label & Growth (Weeks 17–26): Appchain Partnerships
- White-label explorer deployment pipeline (new appchain can get branded explorer in < 1 day)
- Expand to 50+ chains
- Grant applications submitted to Osmosis Grants, Interchain Foundation, Neutron Foundation
- Self-serve alert management dashboard
- Historical transfer search with filters (date range, token, channel, status)

---

## Open Questions

1. **Multi-hop linking for non-memo transfers** — When a user manually sends A→B, then from B→C, how confidently can we link these as a single "transfer" vs two independent transfers? The current plan (address correlation + amount + 30-minute window) may produce false positives for high-volume addresses. Need to define the accuracy/recall tradeoff threshold. — Owner: TBD, Deadline: Before Phase 2

2. **Which 20 chains constitute the launch set?** — Needs validation against live IBC packet volume data (DeFiLlama IBC stats, MapOfZones export). Preliminary list: Cosmos Hub, Osmosis, Neutron, Injective, Stride, Noble, Celestia, Dydx, Akash, Juno, Stargaze, Evmos, Persistence, Agoric, Sei, Archway, Kujira, Nolus, QuickSilver, Umee. — Owner: TBD, Deadline: Week 1

3. **Full node hosting strategy** — Self-hosted full nodes vs third-party RPC providers (Numia, AllNodes, Polkachu). Self-hosted gives full control and no rate limits but costs ~$150–300/month/chain for storage. Third-party is cheaper at low volume but rate-limited. Recommend hybrid: self-hosted for top-5, third-party for the rest. — Owner: TBD, Deadline: Week 2

4. **IBC v2 / Eureka compatibility** — The IBC Eureka upgrade (expected mid-2026) introduces a new packet format and channel abstraction. Does the indexer need to support both IBC v1 and v2 simultaneously? — Owner: TBD, Deadline: Before Phase 3

5. **Grant application strategy and lead chain** — Which ecosystem to approach first: Osmosis Grants Programme, Interchain Foundation's Developer Experience grants, or Neutron Foundation? Each has different timelines and requirements. Osmosis likely fastest (bi-weekly grant cycles). — Owner: TBD, Deadline: Week 4

---

## Appendix

### Competitive Gap Summary
| Feature | IBCscan | Mintscan | MapOfZones | IOBScan |
|---|---|---|---|---|
| Multi-hop transfer trace | ✅ | ❌ | ❌ | ❌ |
| IBC denom hash decoder | ✅ | ❌ | ❌ | ❌ |
| Stuck transfer alerting | ✅ | ❌ | ❌ | ❌ |
| Channel health dashboard | ✅ | Partial | Visual only | Partial |
| Developer REST API | ✅ | Limited | ❌ | ❌ |
| WebSocket streaming | ✅ | ❌ | ❌ | ❌ |
| White-label explorer | ✅ | ❌ | ❌ | ❌ |
| Chain coverage | Top 20 → 50+ | 63 chains | 90 chains | ~12 chains |

### Revenue Model
| Tier | Price | Limits | Target |
|---|---|---|---|
| Free | $0 | 10K req/day, no alerts, 7-day history | Developers, individuals |
| Growth | $99/mo | 200K req/day, 5 alert configs, 90-day history | Small protocols, relayer ops |
| Pro | $299/mo | 1M req/day, unlimited alerts, full history | DeFi teams, relayer operators |
| Enterprise | Custom | Unlimited, SLA, dedicated support, white-label | Appchains, exchanges |

### ICS-20 Packet Data Structure (for reference)
```protobuf
// Decoded from packet.data (base64 protobuf)
message FungibleTokenPacketData {
  string denom    = 1;   // source denom (may be "ibc/HASH" if already a wrapped token)
  string amount   = 2;   // string-encoded integer
  string sender   = 3;   // bech32 address on source chain
  string receiver = 4;   // bech32 address on destination chain
  string memo     = 5;   // optional; ICS-20 v2 forward memo lives here
}
```

### IBC Forward Memo Format (ICS-20 v2 / Packet Forward Middleware)
```json
{
  "forward": {
    "receiver": "inj1finalreceiver...",
    "port": "transfer",
    "channel": "channel-8",
    "timeout": "10m",
    "retries": 2,
    "next": null
  }
}
```
When this memo is present, IBCscan uses `forward.channel` + `forward.receiver` to pre-register the expected next hop before it occurs, enabling proactive tracking rather than retroactive stitching.
