import { createServer, type Server } from 'node:http'
import client from 'prom-client'
import type { IBCPacketEvent } from './types.js'

const register = new client.Registry()
client.collectDefaultMetrics({ register })

const wsConnected = new client.Gauge({
  name: 'ibc_indexer_ws_connected',
  help: 'WebSocket connection state per chain (1 connected, 0 disconnected)',
  labelNames: ['chain_id'],
  registers: [register],
})

const packetsTotal = new client.Counter({
  name: 'ibc_indexer_packets_total',
  help: 'Total IBC packet events processed',
  labelNames: ['chain_id', 'direction'],
  registers: [register],
})

const lastEventHeight = new client.Gauge({
  name: 'ibc_indexer_last_event_height',
  help: 'Last processed block height per chain',
  labelNames: ['chain_id'],
  registers: [register],
})

const lastEventUnix = new client.Gauge({
  name: 'ibc_indexer_last_event_unix_seconds',
  help: 'Unix timestamp of the last processed event per chain',
  labelNames: ['chain_id'],
  registers: [register],
})

export interface IndexerMetrics {
  markConnection(chainId: string, connected: boolean): void
  observePacket(event: IBCPacketEvent): void
  close(): Promise<void>
}

export function startMetricsServer(port = Number(process.env.METRICS_PORT ?? '9105')): IndexerMetrics {
  const server: Server = createServer(async (req, res) => {
    if (req.url !== '/metrics') {
      res.statusCode = 404
      res.end('not found')
      return
    }
    res.setHeader('Content-Type', register.contentType)
    res.end(await register.metrics())
  })

  server.listen(port, '0.0.0.0', () => {
    console.log(`[INDEXER] Metrics server listening on :${port}`)
  })

  return {
    markConnection(chainId: string, connected: boolean) {
      wsConnected.labels(chainId).set(connected ? 1 : 0)
    },
    observePacket(event: IBCPacketEvent) {
      packetsTotal.labels(event.chain_id, event.direction).inc()
      lastEventHeight.labels(event.chain_id).set(event.block_height)
      lastEventUnix.labels(event.chain_id).set(Math.floor(event.block_time.getTime() / 1000))
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    },
  }
}
