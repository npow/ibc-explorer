import { serve } from '@hono/node-server'
import app from './server.js'
import { initCache } from './cache.js'

initCache()

const port = parseInt(process.env['PORT'] ?? '3001')
console.log(`Denom decoder running on http://localhost:${port}`)

serve({ fetch: app.fetch, port })
