import pg from 'pg'
import type { IBCPacketEvent } from './types.js'
import { createHash } from 'node:crypto'

const { Pool } = pg

let pool: pg.Pool | null = null

function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set')
    }
    pool = new Pool({ connectionString })
  }
  return pool
}

export async function initDb(): Promise<void> {
  const client = await getPool().connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS indexer_cursors (
        chain_id    TEXT PRIMARY KEY,
        last_height BIGINT NOT NULL DEFAULT 0,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS transfer_links (
          from_transfer_id TEXT NOT NULL REFERENCES transfers(transfer_id) ON DELETE CASCADE,
          to_transfer_id   TEXT NOT NULL REFERENCES transfers(transfer_id) ON DELETE CASCADE,
          link_type        TEXT NOT NULL,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (from_transfer_id, to_transfer_id)
        )
      `)
    } catch (err) {
      const e = err as { code?: string }
      if (e.code !== '42P01') throw err
    }
    try {
      await client.query(`
        CREATE INDEX IF NOT EXISTS transfer_events_chain_tx_dir_idx
          ON transfer_events (chain_id, tx_hash, direction)
      `)
      await client.query(`
        CREATE INDEX IF NOT EXISTS transfer_events_block_time_idx
          ON transfer_events (block_time DESC)
      `)
    } catch (err) {
      const e = err as { code?: string }
      if (e.code !== '42P01') throw err
    }
    const result = await client.query<{ version: string }>('SELECT version()')
    console.log(`[INDEXER] Postgres: ${result.rows[0].version}`)
  } finally {
    client.release()
  }
}

export async function backfillTransferLinks(
  lookbackHours = 168,
  maxPairs = 20000
): Promise<number> {
  const safeHours = Math.max(1, Math.min(24 * 365, Math.floor(lookbackHours)))
  const safeMaxPairs = Math.max(100, Math.min(500000, Math.floor(maxPairs)))

  const res = await getPool().query(
    `
      WITH recent AS (
        SELECT chain_id, tx_hash, transfer_id, direction
        FROM transfer_events
        WHERE block_time > NOW() - ($1::text || ' hours')::INTERVAL
          AND direction IN ('recv', 'send')
      ),
      pairs AS (
        SELECT DISTINCT
          r.transfer_id AS from_transfer_id,
          s.transfer_id AS to_transfer_id
        FROM recent r
        JOIN recent s
          ON s.chain_id = r.chain_id
         AND s.tx_hash = r.tx_hash
        WHERE r.direction = 'recv'
          AND s.direction = 'send'
          AND r.transfer_id <> s.transfer_id
        LIMIT $2
      )
      INSERT INTO transfer_links (from_transfer_id, to_transfer_id, link_type)
      SELECT from_transfer_id, to_transfer_id, 'backfill_same_tx_recv_to_send'
      FROM pairs
      ON CONFLICT DO NOTHING
    `,
    [safeHours, safeMaxPairs]
  )

  return res.rowCount ?? 0
}

export async function insertPacket(event: IBCPacketEvent): Promise<void> {
  const query = `
    INSERT INTO ibc_packets (
      chain_id, channel_id, port_id, sequence, direction,
      tx_hash, block_height, block_time,
      src_chain_id, dst_chain_id, src_channel, dst_channel,
      sender, receiver, denom, amount, ack_success, raw_event
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8,
      $9, $10, $11, $12,
      $13, $14, $15, $16, $17, $18
    )
    ON CONFLICT (chain_id, channel_id, sequence, direction, block_time) DO NOTHING
  `

  await getPool().query(query, [
    event.chain_id,
    event.channel_id,
    event.port_id,
    event.sequence,
    event.direction,
    event.tx_hash,
    event.block_height,
    event.block_time,
    event.src_chain_id,
    event.dst_chain_id,
    event.src_channel,
    event.dst_channel,
    event.sender ?? null,
    event.receiver ?? null,
    event.denom,
    event.amount,
    event.ack_success ?? null,
    JSON.stringify(event.raw_event),
  ])

  await upsertTransfer(event)
  await upsertCursor(event.chain_id, event.block_height)
}

export async function getPendingPackets(
  chainId: string,
  olderThanMinutes: number
): Promise<IBCPacketEvent[]> {
  const query = `
    SELECT
      chain_id, channel_id, port_id, sequence, direction,
      tx_hash, block_height, block_time,
      src_chain_id, dst_chain_id, src_channel, dst_channel,
      sender, receiver, denom, amount::text AS amount,
      ack_success, raw_event
    FROM ibc_packets
    WHERE
      direction = 'send'
      AND chain_id = $1
      AND block_time < NOW() - ($2 || ' minutes')::INTERVAL
      AND NOT EXISTS (
        SELECT 1 FROM ibc_packets ack
        WHERE ack.chain_id   = ibc_packets.chain_id
          AND ack.channel_id = ibc_packets.channel_id
          AND ack.sequence   = ibc_packets.sequence
          AND ack.direction  IN ('ack', 'timeout')
      )
    ORDER BY block_time ASC
  `

  const result = await getPool().query<DBRow>(query, [chainId, olderThanMinutes])
  return result.rows.map(rowToEvent)
}

export async function getRecentPackets(limit: number): Promise<IBCPacketEvent[]> {
  const query = `
    SELECT
      chain_id, channel_id, port_id, sequence, direction,
      tx_hash, block_height, block_time,
      src_chain_id, dst_chain_id, src_channel, dst_channel,
      sender, receiver, denom, amount::text AS amount,
      ack_success, raw_event
    FROM ibc_packets
    ORDER BY block_time DESC
    LIMIT $1
  `

  const result = await getPool().query<DBRow>(query, [limit])
  return result.rows.map(rowToEvent)
}

export async function getResumeHeight(chainId: string): Promise<number> {
  try {
    const cursorQuery = `
      SELECT last_height
      FROM indexer_cursors
      WHERE chain_id = $1
    `
    const cursorResult = await getPool().query<{ last_height: string | number }>(
      cursorQuery,
      [chainId]
    )
    if (cursorResult.rows.length > 0) {
      return Number(cursorResult.rows[0].last_height)
    }
  } catch (err) {
    const e = err as { code?: string }
    if (e.code !== '42P01') throw err
  }

  // Backward-compatible bootstrap if cursor table is new.
  const maxHeightQuery = `
    SELECT COALESCE(MAX(block_height), 0)::bigint AS max_height
    FROM ibc_packets
    WHERE chain_id = $1
  `
  const maxHeightResult = await getPool().query<{ max_height: string | number }>(
    maxHeightQuery,
    [chainId]
  )
  return Number(maxHeightResult.rows[0]?.max_height ?? 0)
}

export async function getChannelMapping(
  chainId: string,
  channelId: string,
  portId = 'transfer'
): Promise<{
  counterparty_chain_id: string | null
  counterparty_channel_id: string | null
} | null> {
  const res = await getPool().query<{
    counterparty_chain_id: string | null
    counterparty_channel_id: string | null
  }>(
    `
      SELECT counterparty_chain_id, counterparty_channel_id
      FROM channels
      WHERE chain_id = $1 AND channel_id = $2 AND port_id = $3
      LIMIT 1
    `,
    [chainId, channelId, portId]
  )
  return res.rows[0] ?? null
}

export async function upsertChannelMapping(
  chainId: string,
  channelId: string,
  portId: string,
  counterpartyChainId: string | null,
  counterpartyChannelId: string | null,
  state: string | null = null
): Promise<void> {
  await getPool().query(
    `
      INSERT INTO channels (
        chain_id, channel_id, port_id,
        counterparty_chain_id, counterparty_channel_id,
        state, last_seen_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (chain_id, channel_id, port_id) DO UPDATE SET
        counterparty_chain_id = COALESCE(EXCLUDED.counterparty_chain_id, channels.counterparty_chain_id),
        counterparty_channel_id = COALESCE(EXCLUDED.counterparty_channel_id, channels.counterparty_channel_id),
        state = COALESCE(EXCLUDED.state, channels.state),
        last_seen_at = NOW()
    `,
    [chainId, channelId, portId, counterpartyChainId, counterpartyChannelId, state]
  )
}

export async function inferCounterpartyFromPackets(
  localChainId: string,
  direction: 'send' | 'recv',
  srcChannel: string,
  dstChannel: string,
  sequence: number
): Promise<string | null> {
  const oppositeDirection = direction === 'send' ? 'recv' : 'send'

  const exactRes = await getPool().query<{ chain_id: string }>(
    `
      SELECT p.chain_id
      FROM ibc_packets p
      WHERE p.chain_id <> $1
        AND p.direction = $2
        AND p.src_channel = $3
        AND p.dst_channel = $4
        AND p.sequence = $5
      ORDER BY p.block_time DESC
      LIMIT 1
    `,
    [localChainId, oppositeDirection, srcChannel, dstChannel, sequence]
  )
  if (exactRes.rows[0]?.chain_id) return exactRes.rows[0].chain_id

  const recentRes = await getPool().query<{ chain_id: string; c: string | number }>(
    `
      SELECT p.chain_id, COUNT(*)::bigint AS c
      FROM ibc_packets p
      WHERE p.chain_id <> $1
        AND p.direction = $2
        AND p.src_channel = $3
        AND p.dst_channel = $4
        AND p.block_time > NOW() - INTERVAL '30 days'
      GROUP BY p.chain_id
      ORDER BY c DESC
      LIMIT 1
    `,
    [localChainId, oppositeDirection, srcChannel, dstChannel]
  )
  return recentRes.rows[0]?.chain_id ?? null
}

export async function close(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

function transferIdFor(event: IBCPacketEvent): string {
  // Canonical hop key that remains stable across send/recv/ack/timeout events.
  const key = `${event.src_chain_id}:${event.src_channel}:${event.sequence}`
  return createHash('md5').update(key).digest('hex')
}

function statusFromEvent(event: IBCPacketEvent): IBCPacketEvent['direction'] | 'completed' | 'failed_ack' {
  if (event.direction === 'ack') {
    return event.ack_success === false ? 'failed_ack' : 'completed'
  }
  return event.direction
}

function normalizeStatus(
  status: ReturnType<typeof statusFromEvent>
): 'pending' | 'completed' | 'timeout' | 'failed_ack' {
  if (status === 'send' || status === 'recv') return 'pending'
  if (status === 'timeout') return 'timeout'
  if (status === 'failed_ack') return 'failed_ack'
  return 'completed'
}

async function upsertTransfer(event: IBCPacketEvent): Promise<void> {
  const transferId = transferIdFor(event)
  const status = normalizeStatus(statusFromEvent(event))

  // Lifecycle-level status update.
  await getPool().query(
    `
      INSERT INTO transfers (transfer_id, status, started_at, updated_at, stuck_since)
      VALUES ($1, $2, $3, $3, NULL)
      ON CONFLICT (transfer_id) DO UPDATE SET
        status = CASE
          WHEN EXCLUDED.status IN ('timeout', 'failed_ack') THEN EXCLUDED.status
          WHEN EXCLUDED.status = 'completed' AND transfers.status = 'pending' THEN EXCLUDED.status
          ELSE transfers.status
        END,
        updated_at = GREATEST(transfers.updated_at, EXCLUDED.updated_at),
        stuck_since = CASE
          WHEN EXCLUDED.status IN ('completed', 'timeout', 'failed_ack') THEN NULL
          ELSE transfers.stuck_since
        END
    `,
    [transferId, status, event.block_time]
  )

  await maybeLinkTransfers(event, transferId)

  // One-hop graph row keyed by packet identity. Future multi-hop linkage can add hop_index > 0.
  await getPool().query(
    `
      INSERT INTO transfer_hops (
        transfer_id, hop_index, chain_id, channel_id, sequence,
        src_chain_id, dst_chain_id, src_channel, dst_channel,
        denom, amount, sender, receiver, status, started_at, updated_at, stuck_since
      ) VALUES (
        $1, 0, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $14, NULL
      )
      ON CONFLICT (transfer_id, hop_index) DO UPDATE SET
        chain_id = EXCLUDED.chain_id,
        channel_id = EXCLUDED.channel_id,
        sequence = EXCLUDED.sequence,
        src_chain_id = EXCLUDED.src_chain_id,
        dst_chain_id = EXCLUDED.dst_chain_id,
        src_channel = EXCLUDED.src_channel,
        dst_channel = EXCLUDED.dst_channel,
        denom = EXCLUDED.denom,
        amount = EXCLUDED.amount,
        sender = COALESCE(transfer_hops.sender, EXCLUDED.sender),
        receiver = COALESCE(transfer_hops.receiver, EXCLUDED.receiver),
        status = CASE
          WHEN EXCLUDED.status IN ('timeout', 'failed_ack') THEN EXCLUDED.status
          WHEN EXCLUDED.status = 'completed' AND transfer_hops.status = 'pending' THEN EXCLUDED.status
          ELSE transfer_hops.status
        END,
        updated_at = GREATEST(transfer_hops.updated_at, EXCLUDED.updated_at),
        stuck_since = CASE
          WHEN EXCLUDED.status IN ('completed', 'timeout', 'failed_ack') THEN NULL
          ELSE transfer_hops.stuck_since
        END
    `,
    [
      transferId,
      event.chain_id,
      event.channel_id,
      event.sequence,
      event.src_chain_id,
      event.dst_chain_id,
      event.src_channel,
      event.dst_channel,
      event.denom,
      event.amount,
      event.sender ?? null,
      event.receiver ?? null,
      status,
      event.block_time,
    ]
  )

  await getPool().query(
    `
      INSERT INTO transfer_events (
        transfer_id, chain_id, channel_id, sequence, tx_hash, direction, block_time
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT DO NOTHING
    `,
    [
      transferId,
      event.chain_id,
      event.channel_id,
      event.sequence,
      event.tx_hash,
      event.direction,
      event.block_time,
    ]
  )

  // SLA-based stuck mark for pending transfers.
  await getPool().query(
    `
      UPDATE transfers
      SET status = 'stuck',
          stuck_since = COALESCE(stuck_since, started_at),
          updated_at = NOW()
      WHERE transfer_id = $1
        AND status = 'pending'
        AND started_at < NOW() - INTERVAL '30 minutes'
    `,
    [transferId]
  )

  await getPool().query(
    `
      UPDATE transfer_hops
      SET status = 'stuck',
          stuck_since = COALESCE(stuck_since, started_at),
          updated_at = NOW()
      WHERE transfer_id = $1
        AND status = 'pending'
        AND started_at < NOW() - INTERVAL '30 minutes'
    `,
    [transferId]
  )
}

async function maybeLinkTransfers(
  event: IBCPacketEvent,
  transferId: string
): Promise<void> {
  // Packet Forward Middleware commonly emits recv_packet + send_packet
  // in the same tx on an intermediate chain; link these as multi-hop edges.
  if (event.direction === 'send') {
    const parentRes = await getPool().query<{ transfer_id: string }>(
      `
        SELECT e.transfer_id
        FROM transfer_events e
        WHERE e.chain_id = $1
          AND e.tx_hash = $2
          AND e.direction = 'recv'
          AND e.transfer_id <> $3
        ORDER BY e.block_time DESC
        LIMIT 1
      `,
      [event.chain_id, event.tx_hash, transferId]
    )

    const parent = parentRes.rows[0]?.transfer_id
    if (!parent) return

    await getPool().query(
      `
        INSERT INTO transfer_links (from_transfer_id, to_transfer_id, link_type)
        VALUES ($1, $2, 'same_tx_recv_to_send')
        ON CONFLICT DO NOTHING
      `,
      [parent, transferId]
    )
    return
  }

  if (event.direction === 'recv') {
    const childRes = await getPool().query<{ transfer_id: string }>(
      `
        SELECT e.transfer_id
        FROM transfer_events e
        WHERE e.chain_id = $1
          AND e.tx_hash = $2
          AND e.direction = 'send'
          AND e.transfer_id <> $3
        ORDER BY e.block_time ASC
        LIMIT 1
      `,
      [event.chain_id, event.tx_hash, transferId]
    )

    const child = childRes.rows[0]?.transfer_id
    if (!child) return

    await getPool().query(
      `
        INSERT INTO transfer_links (from_transfer_id, to_transfer_id, link_type)
        VALUES ($1, $2, 'same_tx_recv_to_send')
        ON CONFLICT DO NOTHING
      `,
      [transferId, child]
    )
  }
}

export async function upsertCursor(chainId: string, height: number): Promise<void> {
  try {
    await getPool().query(
    `
      INSERT INTO indexer_cursors (chain_id, last_height, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (chain_id) DO UPDATE SET
        last_height = GREATEST(indexer_cursors.last_height, EXCLUDED.last_height),
        updated_at = NOW()
    `,
      [chainId, height]
    )
  } catch (err) {
    const e = err as { code?: string }
    if (e.code !== '42P01') throw err
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface DBRow {
  chain_id: string
  channel_id: string
  port_id: string
  sequence: string | number
  direction: string
  tx_hash: string
  block_height: string | number
  block_time: Date
  src_chain_id: string
  dst_chain_id: string
  src_channel: string
  dst_channel: string
  sender: string | null
  receiver: string | null
  denom: string
  amount: string
  ack_success: boolean | null
  raw_event: Record<string, string>
}

function rowToEvent(row: DBRow): IBCPacketEvent {
  const event: IBCPacketEvent = {
    chain_id: row.chain_id,
    channel_id: row.channel_id,
    port_id: row.port_id,
    sequence: Number(row.sequence),
    direction: row.direction as IBCPacketEvent['direction'],
    tx_hash: row.tx_hash,
    block_height: Number(row.block_height),
    block_time: row.block_time,
    src_chain_id: row.src_chain_id,
    dst_chain_id: row.dst_chain_id,
    src_channel: row.src_channel,
    dst_channel: row.dst_channel,
    denom: row.denom,
    amount: row.amount,
    raw_event: row.raw_event ?? {},
  }
  if (row.sender !== null) event.sender = row.sender
  if (row.receiver !== null) event.receiver = row.receiver
  if (row.ack_success !== null) event.ack_success = row.ack_success
  return event
}
