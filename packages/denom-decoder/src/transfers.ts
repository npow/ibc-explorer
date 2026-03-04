import pg from 'pg'

const { Pool } = pg

type HopStatus = 'completed' | 'pending' | 'stuck' | 'timeout' | 'failed_ack'

interface HopRow {
  transfer_id: string
  hop_index: number
  chain_id: string
  channel_id: string
  sequence: number
  src_chain_id: string
  dst_chain_id: string
  src_channel: string
  dst_channel: string
  denom: string
  amount: string
  sender: string | null
  receiver: string | null
  status: HopStatus
  started_at: Date
  updated_at: Date
  stuck_since: Date | null
}

interface EventRow {
  transfer_id: string
  chain_id: string
  channel_id: string
  sequence: number
  tx_hash: string
  direction: 'send' | 'recv' | 'ack' | 'timeout'
  block_time: Date
}

interface LiveStuckRow {
  transfer_id: string
  chain_id: string
  status: HopStatus
  src_chain_id: string
  dst_chain_id: string
  src_channel: string
  dst_channel: string
  sequence: number
  denom: string
  amount: string
  sender: string | null
  receiver: string | null
  started_at: Date
  updated_at: Date
  stuck_since: Date | null
  tx_hash: string | null
  verification_status:
    | 'verified_unresolved_indexed_source'
    | 'unverifiable_unknown_source'
    | 'unverifiable_source_not_indexed'
}

interface LiveLinkedRow {
  chain_id: string
  tx_hash: string
  linked_transfers: string | number
  last_seen_at: Date
}

let pool: pg.Pool | null = null

function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env['DATABASE_URL']
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set')
    }
    pool = new Pool({ connectionString })
  }
  return pool
}

function mapHopRow(row: Record<string, unknown>): HopRow {
  return {
    transfer_id: String(row['transfer_id']),
    hop_index: Number(row['hop_index']),
    chain_id: String(row['chain_id']),
    channel_id: String(row['channel_id']),
    sequence: Number(row['sequence']),
    src_chain_id: String(row['src_chain_id']),
    dst_chain_id: String(row['dst_chain_id']),
    src_channel: String(row['src_channel']),
    dst_channel: String(row['dst_channel']),
    sender: row['sender'] === null ? null : String(row['sender']),
    receiver: row['receiver'] === null ? null : String(row['receiver']),
    denom: String(row['denom']),
    amount: String(row['amount']),
    status: row['status'] as HopStatus,
    started_at: new Date(String(row['started_at'])),
    updated_at: new Date(String(row['updated_at'])),
    stuck_since:
      row['stuck_since'] === null ? null : new Date(String(row['stuck_since'])),
  }
}

function combineStatus(statuses: HopStatus[]): HopStatus {
  if (statuses.includes('stuck')) return 'stuck'
  if (statuses.includes('failed_ack')) return 'failed_ack'
  if (statuses.includes('timeout')) return 'timeout'
  if (statuses.includes('pending')) return 'pending'
  return 'completed'
}

export async function getTransferTrace(txHash: string, chainId: string) {
  const transferIdsQuery = `
    SELECT DISTINCT transfer_id
    FROM transfer_events
    WHERE tx_hash = $1
      AND chain_id = $2
    ORDER BY transfer_id
  `

  const idsResult = await getPool().query<{ transfer_id: string }>(
    transferIdsQuery,
    [txHash, chainId]
  )
  if (idsResult.rows.length === 0) {
    return null
  }

  const seedTransferId = idsResult.rows[0].transfer_id

  const graphQuery = `
    WITH RECURSIVE graph(transfer_id, depth) AS (
      SELECT $1::text, 0
      UNION ALL
      SELECT n.transfer_id, g.depth + 1
      FROM graph g
      JOIN LATERAL (
        SELECT l.to_transfer_id AS transfer_id
        FROM transfer_links l
        WHERE l.from_transfer_id = g.transfer_id
        UNION
        SELECT l.from_transfer_id AS transfer_id
        FROM transfer_links l
        WHERE l.to_transfer_id = g.transfer_id
      ) n ON TRUE
      WHERE g.depth < 8
    )
    SELECT DISTINCT transfer_id
    FROM graph
  `
  const graphRes = await getPool().query<{ transfer_id: string }>(
    graphQuery,
    [seedTransferId]
  )
  const transferIds = graphRes.rows.map((r) => r.transfer_id)

  const hopsQuery = `
    SELECT
      transfer_id, hop_index, chain_id, channel_id, sequence,
      src_chain_id, dst_chain_id, src_channel, dst_channel,
      denom, amount::text AS amount, sender, receiver, status,
      started_at, updated_at, stuck_since
    FROM transfer_hops
    WHERE transfer_id = ANY($1::text[])
    ORDER BY started_at ASC, hop_index ASC
  `
  const hopsRes = await getPool().query(hopsQuery, [transferIds])
  const hopRows = hopsRes.rows.map((r) => mapHopRow(r as Record<string, unknown>))

  const eventsQuery = `
    SELECT transfer_id, chain_id, channel_id, sequence, tx_hash, direction, block_time
    FROM transfer_events
    WHERE transfer_id = ANY($1::text[])
    ORDER BY block_time ASC
  `
  const eventsRes = await getPool().query<EventRow>(eventsQuery, [transferIds])

  const eventsByHopKey = new Map<string, EventRow[]>()
  for (const e of eventsRes.rows) {
    const key = `${e.chain_id}:${e.channel_id}:${e.sequence}`
    if (!eventsByHopKey.has(key)) eventsByHopKey.set(key, [])
    eventsByHopKey.get(key)!.push(e)
  }

  const hops = hopRows.map((h, idx) => ({
    hop_index: idx,
    transfer_id: h.transfer_id,
    chain_id: h.chain_id,
    channel_id: h.channel_id,
    sequence: h.sequence,
    src_chain_id: h.src_chain_id,
    dst_chain_id: h.dst_chain_id,
    src_channel: h.src_channel,
    dst_channel: h.dst_channel,
    denom: h.denom,
    amount: h.amount,
    sender: h.sender,
    receiver: h.receiver,
    status: h.status,
    started_at: h.started_at.toISOString(),
    updated_at: h.updated_at.toISOString(),
    stuck_since: h.stuck_since?.toISOString() ?? null,
    events: (eventsByHopKey.get(`${h.chain_id}:${h.channel_id}:${h.sequence}`) ?? []).map((e) => ({
      direction: e.direction,
      tx_hash: e.tx_hash,
      block_time: new Date(e.block_time).toISOString(),
    })),
  }))

  const transferStatusQuery = `
    SELECT status, started_at, updated_at
    FROM transfers
    WHERE transfer_id = ANY($1::text[])
  `
  const transferRes = await getPool().query<{
    status: HopStatus
    started_at: Date
    updated_at: Date
  }>(transferStatusQuery, [transferIds])
  const status =
    transferRes.rows.length > 0
      ? combineStatus(transferRes.rows.map((r) => r.status))
      : combineStatus(hops.map((h) => h.status))

  const startedAtValues = transferRes.rows.map((r) => r.started_at.getTime())
  const updatedAtValues = transferRes.rows.map((r) => r.updated_at.getTime())
  const startedAt =
    startedAtValues.length > 0
      ? new Date(Math.min(...startedAtValues)).toISOString()
      : (hops[0]?.started_at ?? null)
  const updatedAt =
    updatedAtValues.length > 0
      ? new Date(Math.max(...updatedAtValues)).toISOString()
      : (hops[hops.length - 1]?.updated_at ?? null)

  return {
    transfer_id: seedTransferId,
    linked_transfer_ids: transferIds,
    tx_hash: txHash,
    chain_id: chainId,
    status,
    hops,
    started_at: startedAt,
    updated_at: updatedAt,
  }
}

export async function getGrantReadinessStatus() {
  const requiredChains = [
    'cosmoshub-4',
    'osmosis-1',
    'neutron-1',
    'injective-1',
    'stride-1',
  ]

  const chainStatsQuery = `
    SELECT
      req.chain_id,
      c.last_height,
      c.updated_at,
      COALESCE(h.events_24h, 0) AS events_24h,
      h.last_event_at
    FROM (
      SELECT unnest($1::text[]) AS chain_id
    ) req
    LEFT JOIN indexer_cursors c ON c.chain_id = req.chain_id
    LEFT JOIN (
      SELECT
        chain_id,
        COUNT(*) FILTER (WHERE block_time > NOW() - INTERVAL '24 hours')::bigint AS events_24h,
        MAX(block_time) AS last_event_at
      FROM ibc_packets
      GROUP BY chain_id
    ) h ON h.chain_id = req.chain_id
    ORDER BY req.chain_id
  `

  const chainRes = await getPool().query<{
    chain_id: string
    last_height: string | number | null
    updated_at: Date | null
    events_24h: string | number
    last_event_at: Date | null
  }>(chainStatsQuery, [requiredChains])

  let multihopTransfers = 0
  try {
    const multihopRes = await getPool().query<{ count: string | number }>(`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT from_transfer_id
        FROM transfer_links
        GROUP BY from_transfer_id
      ) t
    `)
    multihopTransfers = Number(multihopRes.rows[0]?.count ?? 0)
  } catch {
    multihopTransfers = 0
  }

  const freshnessMinutes = Number(process.env['GRANT_CURSOR_FRESH_MINUTES'] ?? '20')
  const freshCutoffMs = Date.now() - freshnessMinutes * 60 * 1000

  const chains = chainRes.rows.map((r) => ({
    chain_id: r.chain_id,
    cursorUpdatedAtIso: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    lastHeightNum: r.last_height === null ? null : Number(r.last_height),
    events24hNum: Number(r.events_24h),
    lastEventAtIso: r.last_event_at ? new Date(r.last_event_at).toISOString() : null,
  })).map((r) => ({
    chain_id: r.chain_id,
    last_height: r.lastHeightNum,
    cursor_updated_at: r.cursorUpdatedAtIso,
    events_24h: r.events24hNum,
    last_event_at: r.lastEventAtIso,
    ready:
      r.lastHeightNum !== null &&
      r.lastHeightNum > 0 &&
      r.cursorUpdatedAtIso !== null &&
      new Date(r.cursorUpdatedAtIso).getTime() >= freshCutoffMs,
  }))

  return {
    checked_at: new Date().toISOString(),
    cursor_freshness_minutes: freshnessMinutes,
    phase1_required_chains: requiredChains,
    chains,
    top5_coverage_ready: chains.every((c) => c.ready),
    multihop_linked_transfers: multihopTransfers,
  }
}

export async function listLiveStuckTransfers(limit: number) {
  const clampedLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(200, Math.floor(limit)))
    : 50

  const query = `
    SELECT
      h.transfer_id,
      h.chain_id,
      h.status,
      h.src_chain_id,
      h.dst_chain_id,
      h.src_channel,
      h.dst_channel,
      h.sequence,
      h.denom,
      h.amount::text AS amount,
      h.sender,
      h.receiver,
      h.started_at,
      h.updated_at,
      h.stuck_since,
      (
        SELECT e.tx_hash
        FROM transfer_events e
        WHERE e.transfer_id = h.transfer_id
          AND e.tx_hash IS NOT NULL
          AND e.tx_hash <> ''
        ORDER BY e.block_time DESC
        LIMIT 1
      ) AS tx_hash,
      CASE
        WHEN h.src_chain_id IS NULL OR h.src_chain_id = 'unknown'
          THEN 'unverifiable_unknown_source'
        WHEN EXISTS (
          SELECT 1
          FROM indexer_cursors ic
          WHERE ic.chain_id = h.src_chain_id
        )
          THEN 'verified_unresolved_indexed_source'
        ELSE 'unverifiable_source_not_indexed'
      END AS verification_status
    FROM transfer_hops h
    WHERE h.hop_index = 0
      AND h.status IN ('stuck', 'failed_ack', 'timeout')
    ORDER BY COALESCE(h.stuck_since, h.updated_at) DESC
    LIMIT $1
  `

  const res = await getPool().query<LiveStuckRow>(query, [clampedLimit])
  return res.rows.map((r) => ({
    transfer_id: r.transfer_id,
    chain_id: r.chain_id,
    status: r.status,
    src_chain_id: r.src_chain_id,
    dst_chain_id: r.dst_chain_id,
    src_channel: r.src_channel,
    dst_channel: r.dst_channel,
    sequence: Number(r.sequence),
    denom: r.denom,
    amount: r.amount,
    sender: r.sender,
    receiver: r.receiver,
    started_at: new Date(r.started_at).toISOString(),
    updated_at: new Date(r.updated_at).toISOString(),
    stuck_since: r.stuck_since ? new Date(r.stuck_since).toISOString() : null,
    tx_hash: r.tx_hash,
    verification_status: r.verification_status,
  }))
}

export async function getGrantEvidenceStatus() {
  const top5 = await getGrantReadinessStatus()

  const coverageQuery = `
    SELECT
      chain_id,
      COUNT(*)::bigint AS packet_count,
      MIN(block_time) AS first_seen_at,
      MAX(block_time) AS last_seen_at
    FROM ibc_packets
    WHERE chain_id = ANY($1::text[])
    GROUP BY chain_id
    ORDER BY chain_id
  `
  const coverageRes = await getPool().query<{
    chain_id: string
    packet_count: string | number
    first_seen_at: Date | null
    last_seen_at: Date | null
  }>(coverageQuery, [top5.phase1_required_chains])

  const coverageByChain = new Map(
    coverageRes.rows.map((r) => [r.chain_id, r] as const)
  )

  const coverage = top5.phase1_required_chains.map((chainId) => {
    const r = coverageByChain.get(chainId)
    return {
      chain_id: chainId,
      packet_count: Number(r?.packet_count ?? 0),
      first_seen_at: r?.first_seen_at ? new Date(r.first_seen_at).toISOString() : null,
      last_seen_at: r?.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
    }
  })

  const unknownRes = await getPool().query<{
    unknown_src: string | number
    unknown_dst: string | number
    total_hops: string | number
  }>(`
    SELECT
      COUNT(*) FILTER (WHERE src_chain_id = 'unknown')::bigint AS unknown_src,
      COUNT(*) FILTER (WHERE dst_chain_id = 'unknown')::bigint AS unknown_dst,
      COUNT(*)::bigint AS total_hops
    FROM transfer_hops
    WHERE started_at > NOW() - INTERVAL '24 hours'
  `)
  const unknown = unknownRes.rows[0]
  const totalHops = Number(unknown?.total_hops ?? 0)
  const unknownSrc = Number(unknown?.unknown_src ?? 0)
  const unknownDst = Number(unknown?.unknown_dst ?? 0)

  const stuckVerificationRes = await getPool().query<{
    verification_status:
      | 'verified_unresolved_indexed_source'
      | 'unverifiable_unknown_source'
      | 'unverifiable_source_not_indexed'
    count: string | number
  }>(`
    SELECT
      CASE
        WHEN h.src_chain_id IS NULL OR h.src_chain_id = 'unknown'
          THEN 'unverifiable_unknown_source'
        WHEN EXISTS (
          SELECT 1
          FROM indexer_cursors ic
          WHERE ic.chain_id = h.src_chain_id
        )
          THEN 'verified_unresolved_indexed_source'
        ELSE 'unverifiable_source_not_indexed'
      END AS verification_status,
      COUNT(*)::bigint AS count
    FROM transfer_hops h
    WHERE h.hop_index = 0
      AND h.status IN ('stuck', 'failed_ack', 'timeout')
    GROUP BY verification_status
    ORDER BY verification_status
  `)

  return {
    checked_at: new Date().toISOString(),
    top5,
    phase1_backfill_coverage: coverage,
    unknown_attribution_24h: {
      total_hops: totalHops,
      unknown_src: unknownSrc,
      unknown_dst: unknownDst,
      unknown_src_ratio: totalHops > 0 ? unknownSrc / totalHops : 0,
      unknown_dst_ratio: totalHops > 0 ? unknownDst / totalHops : 0,
    },
    stuck_verification_breakdown: stuckVerificationRes.rows.map((r) => ({
      verification_status: r.verification_status,
      count: Number(r.count),
    })),
  }
}

export async function listLiveLinkedTransfers(page: number, limit: number) {
  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(100, Math.floor(limit)))
    : 20
  const safePage = Number.isFinite(page)
    ? Math.max(1, Math.floor(page))
    : 1
  const offset = (safePage - 1) * safeLimit

  const countQuery = `
    WITH linked AS (
      SELECT from_transfer_id AS transfer_id FROM transfer_links
      UNION
      SELECT to_transfer_id AS transfer_id FROM transfer_links
    )
    SELECT COUNT(*)::bigint AS total
    FROM (
      SELECT e.chain_id, e.tx_hash
      FROM transfer_events e
      WHERE e.transfer_id IN (SELECT transfer_id FROM linked)
      GROUP BY e.chain_id, e.tx_hash
      HAVING COUNT(DISTINCT e.transfer_id) > 1
    ) t
  `
  const countRes = await getPool().query<{ total: string | number }>(countQuery)
  const total = Number(countRes.rows[0]?.total ?? 0)

  const itemsQuery = `
    WITH linked AS (
      SELECT from_transfer_id AS transfer_id FROM transfer_links
      UNION
      SELECT to_transfer_id AS transfer_id FROM transfer_links
    )
    SELECT
      e.chain_id,
      e.tx_hash,
      COUNT(DISTINCT e.transfer_id)::bigint AS linked_transfers,
      MAX(e.block_time) AS last_seen_at
    FROM transfer_events e
    WHERE e.transfer_id IN (SELECT transfer_id FROM linked)
    GROUP BY e.chain_id, e.tx_hash
    HAVING COUNT(DISTINCT e.transfer_id) > 1
    ORDER BY last_seen_at DESC
    LIMIT $1 OFFSET $2
  `
  const itemsRes = await getPool().query<LiveLinkedRow>(itemsQuery, [
    safeLimit,
    offset,
  ])

  return {
    page: safePage,
    limit: safeLimit,
    total,
    total_pages: Math.max(1, Math.ceil(total / safeLimit)),
    items: itemsRes.rows.map((r) => ({
      chain_id: r.chain_id,
      tx_hash: r.tx_hash,
      linked_transfers: Number(r.linked_transfers),
      last_seen_at: new Date(r.last_seen_at).toISOString(),
    })),
  }
}
