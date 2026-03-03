import pg from 'pg'
import type { IBCPacketEvent } from './types.js'

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
    const result = await client.query<{ version: string }>('SELECT version()')
    console.log(`[INDEXER] Postgres: ${result.rows[0].version}`)
  } finally {
    client.release()
  }
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

export async function close(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
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
