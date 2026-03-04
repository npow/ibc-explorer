import WebSocket from 'ws'
import type { IBCPacketEvent, TendermintWSMessage } from './types.js'
import { parsePacketEvent } from './parser.js'

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? '15000')
const POLL_PAGE_SIZE = Number(process.env.POLL_PAGE_SIZE ?? '100')

const SUBSCRIPTIONS = [
  "tm.event='Tx'",
]

// Supported event type names as they appear in Tendermint events
type SupportedEventType =
  | 'send_packet'
  | 'recv_packet'
  | 'acknowledge_packet'
  | 'timeout_packet'

const SUPPORTED_EVENT_TYPES = new Set<string>([
  'send_packet',
  'recv_packet',
  'acknowledge_packet',
  'timeout_packet',
])

function isSupportedEventType(t: string): t is SupportedEventType {
  return SUPPORTED_EVENT_TYPES.has(t)
}

const RECONNECT_BASE_MS  = 5_000
const RECONNECT_MAX_MS   = 60_000

export type PacketEventCallback = (event: IBCPacketEvent) => Promise<void>

export interface ChainSubscriberConfig {
  chainId: string
  rpcHttp: string
  rpcWs?: string
}

interface SubscriberHooks {
  onConnectionState?: (chainId: string, connected: boolean) => void
}

export class TendermintSubscriber {
  private ws: WebSocket | null = null
  private reconnectDelay = RECONNECT_BASE_MS
  private stopped = false
  private pollTimer: NodeJS.Timeout | null = null
  private isPolling = false
  private lastProcessedHeight = 0
  private readonly seenEventKeys = new Map<string, number>()
  private static readonly SEEN_TTL_MS = 10 * 60 * 1000

  constructor(
    private readonly config: ChainSubscriberConfig,
    private readonly onEvent: PacketEventCallback,
    resumeHeight = 0,
    private readonly hooks: SubscriberHooks = {}
  ) {
    this.lastProcessedHeight = resumeHeight
  }

  connect(): void {
    this.stopped = false
    this.startPolling()
    if (this.config.rpcWs) {
      this.openSocket()
      return
    }
    this.hooks.onConnectionState?.(this.config.chainId, false)
    console.log(
      `[INDEXER ${this.config.chainId}] WebSocket disabled; using HTTP polling only`
    )
  }

  disconnect(): void {
    this.stopped = true
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  private openSocket(): void {
    const wsUrl = this.config.rpcWs
    if (!wsUrl) return
    console.log(`[INDEXER ${this.config.chainId}] Connecting to ${wsUrl}`)
    const ws = new WebSocket(wsUrl)
    this.ws = ws

    ws.on('open', () => {
      console.log(`[INDEXER ${this.config.chainId}] WebSocket connected`)
      this.hooks.onConnectionState?.(this.config.chainId, true)
      this.reconnectDelay = RECONNECT_BASE_MS  // reset backoff on success
      this.subscribe(ws)
    })

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        this.handleMessage(data.toString())
      } catch (err) {
        console.error(
          `[INDEXER ${this.config.chainId}] Unhandled error in message handler:`,
          err
        )
      }
    })

    ws.on('error', (err: Error) => {
      console.error(`[INDEXER ${this.config.chainId}] WebSocket error:`, err.message)
    })

    ws.on('close', (code: number, reason: Buffer) => {
      console.warn(
        `[INDEXER ${this.config.chainId}] WebSocket closed (code=${code} reason=${reason.toString() || 'none'})`
      )
      this.ws = null
      this.hooks.onConnectionState?.(this.config.chainId, false)
      if (!this.stopped) {
        this.scheduleReconnect()
      }
    })
  }

  private subscribe(ws: WebSocket): void {
    SUBSCRIPTIONS.forEach((query, idx) => {
      const msg = JSON.stringify({
        jsonrpc: '2.0',
        method:  'subscribe',
        id:      idx + 1,
        params:  { query },
      })
      ws.send(msg)
      console.log(
        `[INDEXER ${this.config.chainId}] Subscribed (id=${idx + 1}): ${query}`
      )
    })
  }

  private scheduleReconnect(): void {
    const delay = this.reconnectDelay
    console.log(
      `[INDEXER ${this.config.chainId}] Reconnecting in ${delay / 1000}s...`
    )
    setTimeout(() => {
      if (!this.stopped) this.openSocket()
    }, delay)
    // Exponential backoff, capped at max
    this.reconnectDelay = Math.min(delay * 2, RECONNECT_MAX_MS)
  }

  private handleMessage(data: string): void {
    let msg: unknown
    try {
      msg = JSON.parse(data)
    } catch {
      console.error(
        `[INDEXER ${this.config.chainId}] Failed to parse WebSocket message as JSON`
      )
      return
    }

    if (!isTendermintWSMessage(msg)) {
      return
    }

    // Subscription confirmation messages have an empty result (no data)
    if (!msg.result.data) {
      return
    }

    const txResult = msg.result.data.value.TxResult
    if (!txResult) {
      return
    }

    const blockHeight = parseInt(txResult.height, 10)
    if (isNaN(blockHeight)) {
      return
    }
    this.lastProcessedHeight = Math.max(this.lastProcessedHeight, blockHeight)

    // Extract tx hash from the top-level events map if available
    const txHash = extractTxHash(msg.result.events) ?? txResult.tx

    const events = txResult.result.events
    if (!Array.isArray(events)) {
      return
    }

    this.processTxEvents(events, txHash, blockHeight, new Date())
  }

  private processTxEvents(
    events: Array<{
      type: string
      attributes: Array<{ key: string; value: string; index?: boolean }>
    }>,
    txHash: string,
    blockHeight: number,
    blockTime: Date
  ): void {
    for (const event of events) {
      if (!isSupportedEventType(event.type)) continue
      try {
        const packet = parsePacketEvent(
          event.type,
          event.attributes.map((a) => ({ key: a.key, value: a.value })),
          txHash,
          blockHeight,
          blockTime,
          this.config.chainId
        )
        if (!packet) continue

        const dedupeKey = `${txHash}:${packet.chain_id}:${packet.channel_id}:${packet.sequence}:${packet.direction}`
        if (this.isRecentlySeen(dedupeKey)) continue
        this.markSeen(dedupeKey)

        console.log(
          `[INDEXER ${this.config.chainId}] recv ${event.type} ${packet.chain_id} ${packet.channel_id} seq:${packet.sequence}`
        )
        this.onEvent(packet).catch((err: unknown) => {
          console.error(`[INDEXER ${this.config.chainId}] onEvent callback error:`, err)
        })
      } catch (err) {
        console.error(`[INDEXER ${this.config.chainId}] Error parsing packet event:`, err)
      }
    }
  }

  private startPolling(): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => {
      this.pollOnce().catch((err) => {
        console.error(`[INDEXER ${this.config.chainId}] Polling error:`, err)
      })
    }, POLL_INTERVAL_MS)
    // Kick an immediate poll to initialize height state.
    this.pollOnce().catch((err) => {
      console.error(`[INDEXER ${this.config.chainId}] Initial poll error:`, err)
    })
  }

  private async pollOnce(): Promise<void> {
    if (this.stopped || this.isPolling) return
    this.isPolling = true
    try {
      const latest = await this.fetchLatestHeight()
      if (!latest || latest <= 0) return

      if (this.lastProcessedHeight <= 0) {
        // Start at chain tip to avoid huge cold-start backfill over public RPC.
        this.lastProcessedHeight = latest - 1
        return
      }
      if (latest <= this.lastProcessedHeight) return

      const fromHeight = this.lastProcessedHeight + 1
      const toHeight = latest
      await this.pollRange(fromHeight, toHeight)
      this.lastProcessedHeight = toHeight
    } finally {
      this.isPolling = false
      this.evictOldSeen()
    }
  }

  private async pollRange(fromHeight: number, toHeight: number): Promise<void> {
    const queries = [
      "send_packet.packet_src_port='transfer'",
      "recv_packet.packet_dst_port='transfer'",
      "acknowledge_packet.packet_src_port='transfer'",
      "timeout_packet.packet_src_port='transfer'",
    ]
    for (const filter of queries) {
      const q = `tm.event='Tx' AND ${filter} AND tx.height>=${fromHeight} AND tx.height<=${toHeight}`
      let page = 1
      while (true) {
        const result = await this.txSearch(q, page, POLL_PAGE_SIZE)
        const txs = result.txs ?? []
        for (const tx of txs) {
          const h = parseInt(tx.height, 10)
          if (isNaN(h)) continue
          const hash = tx.hash || tx.tx
          const events = tx.tx_result?.events ?? []
          this.processTxEvents(events, hash, h, new Date())
        }
        if (txs.length < POLL_PAGE_SIZE) break
        page += 1
      }
    }
  }

  private async fetchLatestHeight(): Promise<number> {
    const url = `${this.config.rpcHttp}/status`
    const res = await fetch(url)
    if (!res.ok) return 0
    const json = (await res.json()) as {
      result?: { sync_info?: { latest_block_height?: string } }
    }
    const h = json.result?.sync_info?.latest_block_height
    return h ? Number(h) : 0
  }

  private async txSearch(query: string, page: number, perPage: number): Promise<{
    txs?: Array<{
      hash: string
      height: string
      tx: string
      tx_result?: {
        events?: Array<{
          type: string
          attributes: Array<{ key: string; value: string; index?: boolean }>
        }>
      }
    }>
  }> {
    const params = new URLSearchParams({
      query: `"${query}"`,
      prove: 'false',
      page: String(page),
      per_page: String(perPage),
      order_by: '"asc"',
    })
    const url = `${this.config.rpcHttp}/tx_search?${params.toString()}`
    const res = await fetch(url)
    if (!res.ok) return {}
    const json = (await res.json()) as { result?: { txs?: unknown[] } }
    return (json.result ?? {}) as {
      txs?: Array<{
        hash: string
        height: string
        tx: string
        tx_result?: {
          events?: Array<{
            type: string
            attributes: Array<{ key: string; value: string; index?: boolean }>
          }>
        }
      }>
    }
  }

  private isRecentlySeen(key: string): boolean {
    const now = Date.now()
    const seenAt = this.seenEventKeys.get(key)
    return seenAt !== undefined && now - seenAt < TendermintSubscriber.SEEN_TTL_MS
  }

  private markSeen(key: string): void {
    this.seenEventKeys.set(key, Date.now())
  }

  private evictOldSeen(): void {
    const now = Date.now()
    for (const [k, t] of this.seenEventKeys) {
      if (now - t > TendermintSubscriber.SEEN_TTL_MS) {
        this.seenEventKeys.delete(k)
      }
    }
  }
}

// ── Type guards ───────────────────────────────────────────────────────────────

function isTendermintWSMessage(v: unknown): v is TendermintWSMessage {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  if (obj['jsonrpc'] !== '2.0') return false
  if (typeof obj['result'] !== 'object' || obj['result'] === null) return false
  return true
}

function extractTxHash(
  events: Record<string, string[]> | undefined
): string | undefined {
  if (!events) return undefined
  const hashes = events['tx.hash']
  if (Array.isArray(hashes) && hashes.length > 0) return hashes[0]
  return undefined
}
