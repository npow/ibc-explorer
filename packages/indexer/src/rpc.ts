import WebSocket from 'ws'
import type { IBCPacketEvent, TendermintWSMessage } from './types.js'
import { parsePacketEvent } from './parser.js'

const OSMOSIS_RPC_WS =
  process.env.OSMOSIS_RPC_WS ?? 'wss://rpc.osmosis.zone/websocket'

const OSMOSIS_CHAIN_ID = process.env.OSMOSIS_CHAIN_ID ?? 'osmosis-1'

const SUBSCRIPTIONS = [
  "tm.event='Tx' AND send_packet.packet_src_port='transfer'",
  "tm.event='Tx' AND recv_packet.packet_dst_port='transfer'",
  "tm.event='Tx' AND acknowledge_packet.packet_src_port='transfer'",
  "tm.event='Tx' AND timeout_packet.packet_src_port='transfer'",
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

export class TendermintSubscriber {
  private ws: WebSocket | null = null
  private reconnectDelay = RECONNECT_BASE_MS
  private stopped = false

  constructor(private readonly onEvent: PacketEventCallback) {}

  connect(): void {
    this.stopped = false
    this.openSocket()
  }

  disconnect(): void {
    this.stopped = true
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  private openSocket(): void {
    console.log(`[INDEXER] Connecting to ${OSMOSIS_RPC_WS}`)
    const ws = new WebSocket(OSMOSIS_RPC_WS)
    this.ws = ws

    ws.on('open', () => {
      console.log('[INDEXER] WebSocket connected')
      this.reconnectDelay = RECONNECT_BASE_MS  // reset backoff on success
      this.subscribe(ws)
    })

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        this.handleMessage(data.toString())
      } catch (err) {
        console.error('[INDEXER] Unhandled error in message handler:', err)
      }
    })

    ws.on('error', (err: Error) => {
      console.error('[INDEXER] WebSocket error:', err.message)
    })

    ws.on('close', (code: number, reason: Buffer) => {
      console.warn(
        `[INDEXER] WebSocket closed (code=${code} reason=${reason.toString() || 'none'})`
      )
      this.ws = null
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
      console.log(`[INDEXER] Subscribed (id=${idx + 1}): ${query}`)
    })
  }

  private scheduleReconnect(): void {
    const delay = this.reconnectDelay
    console.log(`[INDEXER] Reconnecting in ${delay / 1000}s...`)
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
      console.error('[INDEXER] Failed to parse WebSocket message as JSON')
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

    // Extract tx hash from the top-level events map if available
    const txHash = extractTxHash(msg.result.events) ?? txResult.tx

    // Use current time as an approximation; a real indexer would fetch
    // the block header to get the precise block_time.
    const blockTime = new Date()

    for (const event of txResult.result.events) {
      if (!isSupportedEventType(event.type)) continue

      try {
        const packet = parsePacketEvent(
          event.type,
          event.attributes,
          txHash,
          blockHeight,
          blockTime,
          OSMOSIS_CHAIN_ID
        )

        if (!packet) continue

        console.log(
          `[INDEXER] recv ${event.type} ${packet.chain_id} ${packet.channel_id} seq:${packet.sequence}`
        )

        this.onEvent(packet).catch((err: unknown) => {
          console.error('[INDEXER] onEvent callback error:', err)
        })
      } catch (err) {
        console.error('[INDEXER] Error parsing packet event:', err)
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
