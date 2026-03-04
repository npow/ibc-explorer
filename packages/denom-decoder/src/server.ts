import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { decode } from './decoder.js'
import { getCacheStats } from './cache.js'
import {
  getGrantReadinessStatus,
  getTransferTrace,
  listLiveStuckTransfers,
} from './transfers.js'

const app = new Hono()

// Allow requests from any origin so the web UI can call this API from localhost
// or from a deployed frontend without CORS errors.
app.use('*', cors())

/**
 * GET /health
 *
 * Returns the service status and current cache statistics.
 */
app.get('/health', (c) => {
  const cacheStats = getCacheStats()
  return c.json({
    status: 'ok',
    cache_stats: {
      total: cacheStats.total,
      oldest: cacheStats.oldest,
      newest: cacheStats.newest,
    },
  })
})

/**
 * GET /decode
 *
 * Query params:
 *   denom  (required) — the full ibc/HASH string
 *   chain  (optional, default: "osmosis-1") — chain_id to query
 *
 * Returns the resolved denom trace on success, or a JSON error object.
 */
app.get('/decode', async (c) => {
  const denom = c.req.query('denom')
  const chainId = c.req.query('chain') ?? 'osmosis-1'

  if (!denom) {
    return c.json({ error: 'Missing required query parameter: denom' }, 400)
  }

  try {
    const result = await decode(denom, chainId)

    return c.json({
      denom: result.denom,
      chain_id: result.chain_id,
      path: result.path,
      base_denom: result.base_denom,
      hops: result.hops,
      resolved_from: result.resolved_from,
      cached_at: result.cached_at ?? null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred.'

    // Distinguish between client errors and server errors based on message content.
    if (
      message.includes('must start with ibc/') ||
      message.includes('Unknown chain') ||
      message.includes('was not found on chain')
    ) {
      return c.json({ error: message }, 400)
    }

    return c.json({ error: message }, 500)
  }
})

// Backward-compatible alias with the README/API shape
app.get('/v1/denoms/decode', async (c) => {
  const denom = c.req.query('denom')
  const chainId = c.req.query('chain') ?? 'osmosis-1'

  if (!denom) {
    return c.json({ error: 'Missing required query parameter: denom' }, 400)
  }

  try {
    const result = await decode(denom, chainId)
    return c.json({
      denom: result.denom,
      chain_id: result.chain_id,
      path: result.path,
      base_denom: result.base_denom,
      hops: result.hops,
      resolved_from: result.resolved_from,
      cached_at: result.cached_at ?? null,
    })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'An unexpected error occurred.'
    return c.json({ error: message }, 400)
  }
})

app.get('/v1/transfers/stuck', async (c) => {
  const limitRaw = c.req.query('limit')
  const limit = limitRaw ? Number(limitRaw) : 50

  try {
    const rows = await listLiveStuckTransfers(limit)
    return c.json({
      count: rows.length,
      items: rows,
    })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'An unexpected error occurred.'
    return c.json({ error: message }, 500)
  }
})

app.get('/v1/transfers/:txHash', async (c) => {
  const txHash = c.req.param('txHash')
  const chainId = c.req.query('chain') ?? 'osmosis-1'

  if (!txHash) {
    return c.json({ error: 'Missing required path parameter: txHash' }, 400)
  }

  try {
    const trace = await getTransferTrace(txHash, chainId)
    if (!trace) {
      return c.json(
        { error: `Transfer not found for tx_hash="${txHash}" on chain="${chainId}"` },
        404
      )
    }
    return c.json(trace)
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'An unexpected error occurred.'
    return c.json({ error: message }, 500)
  }
})

app.get('/v1/status/grant-readiness', async (c) => {
  try {
    const status = await getGrantReadinessStatus()
    return c.json(status)
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'An unexpected error occurred.'
    return c.json({ error: message }, 500)
  }
})

export default app
