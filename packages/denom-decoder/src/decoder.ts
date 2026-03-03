import { chains } from './chains.js'
import { getCache, setCache } from './cache.js'

export interface Hop {
  channel: string // e.g. "channel-141"
  port: string    // always "transfer" for ICS-20
}

export interface DenomTrace {
  denom: string            // full ibc/HASH input
  chain_id: string
  path: string             // e.g. "transfer/channel-0" or "transfer/channel-141/transfer/channel-0"
  base_denom: string       // e.g. "uatom"
  hops: Hop[]
  resolved_from: 'cache' | 'live_node'
  cached_at?: string
}

/** Shape of the LCD response body for a denom trace lookup. */
interface LcdDenomTraceResponse {
  denom_trace: {
    path: string
    base_denom: string
  }
}

/**
 * Parse an ICS-20 transfer path string into individual hops.
 *
 * A single-hop path looks like:   "transfer/channel-0"
 * A multi-hop path looks like:    "transfer/channel-141/transfer/channel-0"
 *
 * Each hop is separated by "/transfer/" — we split on that delimiter and
 * re-attach the "transfer/" port prefix so every segment is a full
 * "port/channel" pair before extracting the channel ID.
 */
export function parsePath(tracePath: string): Hop[] {
  // Split on the literal string "/transfer/" to isolate hop segments.
  // The first segment already starts with "transfer/", the rest do not.
  const rawSegments = tracePath.split('/transfer/')

  // Re-normalise: the first raw segment is "transfer/channel-X", subsequent
  // ones are just "channel-X" (the leading "/transfer/" was consumed by split).
  const hops: Hop[] = rawSegments.map((segment, index) => {
    const channelPart = index === 0
      ? segment.replace(/^transfer\//, '') // strip leading "transfer/" from first
      : segment

    return {
      channel: channelPart,
      port: 'transfer',
    }
  })

  return hops
}

/**
 * Resolve an IBC denom hash to its denomtrace on the given chain.
 *
 * Resolution order:
 *   1. SQLite cache  (free, instant)
 *   2. Live LCD node (one HTTP GET, then cached for next time)
 */
export async function decode(denom: string, chainId: string): Promise<DenomTrace> {
  // 1. Validate input format.
  if (!denom.startsWith('ibc/')) {
    throw new Error(
      `Invalid denom "${denom}": denom must start with ibc/`
    )
  }

  const hash = denom.slice(4) // everything after "ibc/"

  // 2. Cache lookup.
  const cached = getCache(chainId, hash)
  if (cached) {
    return {
      denom,
      chain_id: chainId,
      path: cached.path,
      base_denom: cached.base_denom,
      hops: parsePath(cached.path),
      resolved_from: 'cache',
      cached_at: cached.resolved_at,
    }
  }

  // 3. Validate that we know this chain.
  const chainInfo = chains[chainId]
  if (!chainInfo) {
    const knownChains = Object.keys(chains).join(', ')
    throw new Error(
      `Unknown chain "${chainId}". Supported chains: ${knownChains}`
    )
  }

  // 4. Fetch from the LCD node.
  const url = `${chainInfo.lcdUrl}/ibc/apps/transfer/v1/denom_traces/${hash}`

  let response: Response
  try {
    response = await fetch(url)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Failed to reach LCD node for chain "${chainId}" (${chainInfo.lcdUrl}): ${message}`
    )
  }

  // 5. Handle 404 — denom not found on this chain.
  if (response.status === 404) {
    throw new Error(
      `Denom "${denom}" was not found on chain "${chainId}". ` +
      `The token may not have been transferred to this chain, or the hash may be incorrect.`
    )
  }

  if (!response.ok) {
    throw new Error(
      `LCD node for chain "${chainId}" returned HTTP ${response.status} when looking up denom "${denom}".`
    )
  }

  let data: LcdDenomTraceResponse
  try {
    data = (await response.json()) as LcdDenomTraceResponse
  } catch {
    throw new Error(
      `LCD node for chain "${chainId}" returned an invalid JSON response for denom "${denom}".`
    )
  }

  if (!data.denom_trace?.path || !data.denom_trace?.base_denom) {
    throw new Error(
      `LCD node for chain "${chainId}" returned an unexpected response structure for denom "${denom}".`
    )
  }

  const { path: tracePath, base_denom: baseDenom } = data.denom_trace

  // 6. Store in cache.
  setCache(chainId, hash, tracePath, baseDenom)

  // 7. Return result.
  return {
    denom,
    chain_id: chainId,
    path: tracePath,
    base_denom: baseDenom,
    hops: parsePath(tracePath),
    resolved_from: 'live_node',
  }
}
