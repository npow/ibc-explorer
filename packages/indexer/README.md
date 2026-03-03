# @ibc-explorer/indexer

A Node.js TypeScript background worker that connects to the Osmosis public
Tendermint WebSocket RPC and streams IBC packet events (send, recv, ack,
timeout) in real time, writing each packet to a Postgres database.

## What it does

1. Opens a persistent WebSocket connection to `wss://rpc.osmosis.zone/websocket`
2. Subscribes to four Tendermint event queries covering every IBC transfer packet direction
3. Parses raw `send_packet`, `recv_packet`, `acknowledge_packet`, and `timeout_packet`
   events into structured `IBCPacketEvent` records
4. Resolves the counterparty chain ID from a static channel registry (`src/channels.ts`)
5. Upserts each packet into the `ibc_packets` TimescaleDB table (deduplication via
   `ON CONFLICT DO NOTHING`)
6. Reconnects automatically with exponential backoff (5 s → 60 s) on disconnect

## Prerequisites

- Node.js 20+
- A running Postgres instance with the schema applied (`db/schema.sql` from the
  repo root)

## Run in development

```sh
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ibc_explorer \
  npm run dev
```

`npm run dev` uses `tsx watch` so the worker restarts on any source change.

## Build and run in production

```sh
npm run build          # emits to dist/
node dist/index.js
```

## Environment variables

| Variable          | Default                              | Description                          |
|-------------------|--------------------------------------|--------------------------------------|
| `DATABASE_URL`    | *(required)*                         | Postgres connection string           |
| `OSMOSIS_RPC_WS`  | `wss://rpc.osmosis.zone/websocket`   | Tendermint WebSocket endpoint        |
| `OSMOSIS_CHAIN_ID`| `osmosis-1`                          | Chain ID stored in packet records    |

Copy `.env.example` to `.env` and fill in the values.

## Tests

```sh
npm test
```

Tests exercise the packet parser (`src/parser.ts`) in isolation — no network or
database required.

## Connecting to a different chain

1. Change `OSMOSIS_RPC_WS` to the target chain's Tendermint WebSocket URL.
2. Update `OSMOSIS_CHAIN_ID` to the target chain's chain ID.
3. Replace (or extend) `src/channels.ts` with the channel-to-counterparty mapping
   for the target chain.
