-- IBC Explorer — Postgres schema
-- Run: psql $DATABASE_URL -f db/schema.sql

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ── Denom cache ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS denom_traces (
  chain_id    TEXT NOT NULL,
  denom_hash  TEXT NOT NULL,
  path        TEXT NOT NULL,
  base_denom  TEXT NOT NULL,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, denom_hash)
);

-- ── IBC packets ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ibc_packets (
  id            BIGSERIAL,
  chain_id      TEXT        NOT NULL,
  channel_id    TEXT        NOT NULL,
  port_id       TEXT        NOT NULL DEFAULT 'transfer',
  sequence      BIGINT      NOT NULL,
  direction     TEXT        NOT NULL CHECK (direction IN ('send','recv','ack','timeout')),
  tx_hash       TEXT        NOT NULL,
  block_height  BIGINT      NOT NULL,
  block_time    TIMESTAMPTZ NOT NULL,
  src_chain_id  TEXT        NOT NULL,
  dst_chain_id  TEXT        NOT NULL,
  src_channel   TEXT        NOT NULL,
  dst_channel   TEXT        NOT NULL,
  sender        TEXT,
  receiver      TEXT,
  denom         TEXT        NOT NULL,
  amount        NUMERIC     NOT NULL,
  ack_success   BOOLEAN,
  raw_event     JSONB,
  PRIMARY KEY (id, block_time)
);

SELECT create_hypertable('ibc_packets', 'block_time', if_not_exists => TRUE);

CREATE UNIQUE INDEX IF NOT EXISTS ibc_packets_dedup
  ON ibc_packets (chain_id, channel_id, sequence, direction, block_time);

CREATE INDEX IF NOT EXISTS ibc_packets_tx_hash  ON ibc_packets (tx_hash);
CREATE INDEX IF NOT EXISTS ibc_packets_sender   ON ibc_packets (sender)   WHERE sender IS NOT NULL;
CREATE INDEX IF NOT EXISTS ibc_packets_receiver ON ibc_packets (receiver) WHERE receiver IS NOT NULL;
CREATE INDEX IF NOT EXISTS ibc_packets_pending
  ON ibc_packets (chain_id, channel_id, sequence, block_time)
  WHERE direction = 'send';

-- ── Channel registry ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS channels (
  chain_id        TEXT NOT NULL,
  channel_id      TEXT NOT NULL,
  port_id         TEXT NOT NULL DEFAULT 'transfer',
  counterparty_chain_id   TEXT,
  counterparty_channel_id TEXT,
  state           TEXT,
  last_seen_at    TIMESTAMPTZ,
  PRIMARY KEY (chain_id, channel_id, port_id)
);

-- ── Indexer cursors ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS indexer_cursors (
  chain_id     TEXT PRIMARY KEY,
  last_height  BIGINT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Transfer stitching ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS transfers (
  transfer_id    TEXT PRIMARY KEY,
  status         TEXT NOT NULL CHECK (status IN ('pending','completed','stuck','timeout','failed_ack')),
  started_at     TIMESTAMPTZ NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL,
  stuck_since    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS transfer_hops (
  transfer_id    TEXT NOT NULL REFERENCES transfers(transfer_id) ON DELETE CASCADE,
  hop_index      INT  NOT NULL,
  chain_id       TEXT NOT NULL,
  channel_id     TEXT NOT NULL,
  sequence       BIGINT NOT NULL,
  src_chain_id   TEXT NOT NULL,
  dst_chain_id   TEXT NOT NULL,
  src_channel    TEXT NOT NULL,
  dst_channel    TEXT NOT NULL,
  denom          TEXT NOT NULL,
  amount         NUMERIC NOT NULL,
  sender         TEXT,
  receiver       TEXT,
  status         TEXT NOT NULL CHECK (status IN ('pending','completed','stuck','timeout','failed_ack')),
  started_at     TIMESTAMPTZ NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL,
  stuck_since    TIMESTAMPTZ,
  PRIMARY KEY (transfer_id, hop_index)
);

DROP INDEX IF EXISTS transfer_hops_packet_key;
CREATE INDEX IF NOT EXISTS transfer_hops_src_key
  ON transfer_hops (src_chain_id, src_channel, sequence);

CREATE TABLE IF NOT EXISTS transfer_events (
  transfer_id    TEXT NOT NULL REFERENCES transfers(transfer_id) ON DELETE CASCADE,
  chain_id       TEXT NOT NULL,
  channel_id     TEXT NOT NULL,
  sequence       BIGINT NOT NULL,
  tx_hash        TEXT NOT NULL,
  direction      TEXT NOT NULL CHECK (direction IN ('send','recv','ack','timeout')),
  block_time     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (transfer_id, chain_id, channel_id, sequence, tx_hash, direction)
);

CREATE INDEX IF NOT EXISTS transfer_events_tx_hash ON transfer_events (tx_hash);
ALTER TABLE transfer_events ADD COLUMN IF NOT EXISTS channel_id TEXT;
ALTER TABLE transfer_events ADD COLUMN IF NOT EXISTS sequence BIGINT;
