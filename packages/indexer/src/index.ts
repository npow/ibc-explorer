import { initDb, close, insertPacket, getResumeHeight } from './db.js'
import {
  TendermintSubscriber,
  type ChainSubscriberConfig,
} from './rpc.js'
import { startMetricsServer } from './metrics.js'

const DEFAULT_CHAIN_CONFIGS: ChainSubscriberConfig[] = [
  {
    chainId: process.env.OSMOSIS_CHAIN_ID ?? 'osmosis-1',
    rpcWs: process.env.OSMOSIS_RPC_WS ?? 'wss://rpc.osmosis.zone/websocket',
    rpcHttp:
      process.env.OSMOSIS_RPC_HTTP ??
      (process.env.OSMOSIS_RPC_WS ?? 'wss://rpc.osmosis.zone/websocket')
        .replace(/^wss:\/\//, 'https://')
        .replace(/^ws:\/\//, 'http://')
        .replace(/\/websocket$/, ''),
  },
]

function parseChainConfigs(): ChainSubscriberConfig[] {
  const raw = process.env.CHAIN_CONFIGS_JSON
  if (!raw) return DEFAULT_CHAIN_CONFIGS

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(
      `Invalid CHAIN_CONFIGS_JSON: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('CHAIN_CONFIGS_JSON must be a non-empty JSON array')
  }

  return parsed.map((item, idx) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`CHAIN_CONFIGS_JSON[${idx}] must be an object`)
    }
    const obj = item as Record<string, unknown>
    const chainId = String(obj['chainId'] ?? '').trim()
    const rpcHttp = String(obj['rpcHttp'] ?? '').trim().replace(/\/$/, '')
    const rpcWsRaw = obj['rpcWs']
    const rpcWs =
      typeof rpcWsRaw === 'string' && rpcWsRaw.trim().length > 0
        ? rpcWsRaw.trim()
        : undefined

    if (!chainId) {
      throw new Error(`CHAIN_CONFIGS_JSON[${idx}].chainId is required`)
    }
    if (!rpcHttp) {
      throw new Error(`CHAIN_CONFIGS_JSON[${idx}].rpcHttp is required`)
    }

    return { chainId, rpcHttp, rpcWs }
  })
}

async function main() {
  console.log('[INDEXER] Starting multi-chain IBC packet indexer...')

  await initDb()
  console.log('[INDEXER] Database connected')
  const metrics = startMetricsServer()

  const chainConfigs = parseChainConfigs()
  console.log(
    `[INDEXER] Chains configured: ${chainConfigs.map((c) => c.chainId).join(', ')}`
  )

  const subscribers: TendermintSubscriber[] = []
  for (const cfg of chainConfigs) {
    const resumeHeight = await getResumeHeight(cfg.chainId)
    console.log(`[INDEXER ${cfg.chainId}] Resume height: ${resumeHeight}`)

    const subscriber = new TendermintSubscriber(
      cfg,
      async (event) => {
        await insertPacket(event)
        metrics.observePacket(event)
        console.log(
          `[INDEXER ${cfg.chainId}] ${event.direction.padEnd(7)} ${event.channel_id} seq:${event.sequence} ${event.denom} ${event.amount}`
        )
      },
      resumeHeight,
      {
        onConnectionState: (chainId, connected) => {
          metrics.markConnection(chainId, connected)
        },
      }
    )
    subscribers.push(subscriber)
  }

  for (const subscriber of subscribers) {
    subscriber.connect()
  }
  console.log('[INDEXER] Subscribers started')

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('[INDEXER] Shutting down...')
    for (const subscriber of subscribers) {
      subscriber.disconnect()
    }
    await metrics.close()
    await close()
    process.exit(0)
  })
}

main().catch(console.error)
