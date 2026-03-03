import { initDb, close, insertPacket } from './db.js'
import { TendermintSubscriber } from './rpc.js'

async function main() {
  console.log('[INDEXER] Starting Osmosis IBC packet indexer...')

  await initDb()
  console.log('[INDEXER] Database connected')

  const subscriber = new TendermintSubscriber(async (event) => {
    await insertPacket(event)
    console.log(
      `[INDEXER] ${event.direction.padEnd(7)} ${event.channel_id} seq:${event.sequence} ${event.denom} ${event.amount}`
    )
  })

  subscriber.connect()
  console.log('[INDEXER] Subscribed to Osmosis IBC events')

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('[INDEXER] Shutting down...')
    subscriber.disconnect()
    await close()
    process.exit(0)
  })
}

main().catch(console.error)
