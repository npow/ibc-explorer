import type { IBCPacketEvent } from './types.js'
import { resolveCounterparty } from './channels.js'
import {
  getChannelMapping,
  inferCounterpartyFromPackets,
  upsertChannelMapping,
} from './db.js'

type CacheEntry = {
  counterpartyChainId: string | null
  counterpartyChannelId: string | null
  expiresAt: number
}

export interface ChannelResolverConfig {
  chainId: string
  rpcHttp: string
}

export class ChannelResolver {
  private readonly rpcByChain = new Map<string, string>()
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inFlight = new Map<string, Promise<CacheEntry | null>>()
  private readonly ttlMs: number

  constructor(configs: ChannelResolverConfig[]) {
    for (const c of configs) {
      this.rpcByChain.set(c.chainId, c.rpcHttp.replace(/\/$/, ''))
    }
    const ttlMinutes = Number(process.env.CHANNEL_RESOLVE_TTL_MINUTES ?? '360')
    this.ttlMs = Math.max(1, ttlMinutes) * 60 * 1000
  }

  async enrichEvent(event: IBCPacketEvent): Promise<IBCPacketEvent> {
    if (event.direction === 'recv') {
      const resolved = await this.resolveCounterparty(
        event.chain_id,
        event.dst_channel,
        event.port_id,
        event.direction,
        event.src_channel,
        event.dst_channel,
        event.sequence
      )
      if (resolved?.counterpartyChainId) {
        event.src_chain_id = resolved.counterpartyChainId
      }
    } else {
      const inferDir: 'send' | 'recv' = 'send'
      const resolved = await this.resolveCounterparty(
        event.chain_id,
        event.src_channel,
        event.port_id,
        inferDir,
        event.src_channel,
        event.dst_channel,
        event.sequence
      )
      if (resolved?.counterpartyChainId) {
        event.dst_chain_id = resolved.counterpartyChainId
      }
    }
    return event
  }

  private cacheKey(chainId: string, channelId: string, portId: string): string {
    return `${chainId}:${portId}:${channelId}`
  }

  private getStaticFallback(chainId: string, channelId: string): CacheEntry | null {
    if (chainId !== 'osmosis-1') return null
    const m = resolveCounterparty(channelId)
    if (!m) return null
    return {
      counterpartyChainId: m.chain_id,
      counterpartyChannelId: m.counterparty_channel,
      expiresAt: Date.now() + this.ttlMs,
    }
  }

  private async resolveCounterparty(
    chainId: string,
    channelId: string,
    portId = 'transfer',
    direction: 'send' | 'recv' = 'send',
    srcChannel: string,
    dstChannel: string,
    sequence: number
  ): Promise<{ counterpartyChainId: string | null; counterpartyChannelId: string | null } | null> {
    const key = this.cacheKey(chainId, channelId, portId)
    const now = Date.now()

    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > now) {
      return {
        counterpartyChainId: cached.counterpartyChainId,
        counterpartyChannelId: cached.counterpartyChannelId,
      }
    }

    const dbCached = await getChannelMapping(chainId, channelId, portId)
    if (dbCached?.counterparty_chain_id || dbCached?.counterparty_channel_id) {
      this.cache.set(key, {
        counterpartyChainId: dbCached.counterparty_chain_id,
        counterpartyChannelId: dbCached.counterparty_channel_id,
        expiresAt: now + this.ttlMs,
      })
      return {
        counterpartyChainId: dbCached.counterparty_chain_id,
        counterpartyChannelId: dbCached.counterparty_channel_id,
      }
    }

    const inferredFromPackets = await inferCounterpartyFromPackets(
      chainId,
      direction,
      srcChannel,
      dstChannel,
      sequence
    )
    if (inferredFromPackets) {
      const inferred = {
        counterpartyChainId: inferredFromPackets,
        counterpartyChannelId: direction === 'send' ? dstChannel : srcChannel,
      }
      this.cache.set(key, {
        ...inferred,
        expiresAt: now + this.ttlMs,
      })
      await upsertChannelMapping(
        chainId,
        channelId,
        portId,
        inferred.counterpartyChainId,
        inferred.counterpartyChannelId
      )
      return inferred
    }

    if (this.inFlight.has(key)) {
      const v = await this.inFlight.get(key)!
      return v
        ? {
            counterpartyChainId: v.counterpartyChainId,
            counterpartyChannelId: v.counterpartyChannelId,
          }
        : null
    }

    const p = this.fetchAndCache(chainId, channelId, portId)
    this.inFlight.set(key, p)
    try {
      const v = await p
      return v
        ? {
            counterpartyChainId: v.counterpartyChainId,
            counterpartyChannelId: v.counterpartyChannelId,
          }
        : null
    } finally {
      this.inFlight.delete(key)
    }
  }

  private async fetchAndCache(
    chainId: string,
    channelId: string,
    portId: string
  ): Promise<CacheEntry | null> {
    const rpc = this.rpcByChain.get(chainId)
    if (!rpc) {
      const fallback = this.getStaticFallback(chainId, channelId)
      if (fallback) this.cache.set(this.cacheKey(chainId, channelId, portId), fallback)
      return fallback
    }

    try {
      const chanRes = await fetch(
        `${rpc}/ibc/core/channel/v1/channels/${encodeURIComponent(channelId)}/ports/${encodeURIComponent(portId)}`
      )
      if (!chanRes.ok) throw new Error(`channel query failed ${chanRes.status}`)
      const chanJson = (await chanRes.json()) as {
        channel?: {
          state?: string
          counterparty?: { channel_id?: string | null }
          connection_hops?: string[]
        }
      }
      const channel = chanJson.channel
      const counterpartyChannelId = channel?.counterparty?.channel_id ?? null
      const connectionId = channel?.connection_hops?.[0]

      let counterpartyChainId: string | null = null
      if (connectionId) {
        const connRes = await fetch(
          `${rpc}/ibc/core/connection/v1/connections/${encodeURIComponent(connectionId)}`
        )
        if (connRes.ok) {
          const connJson = (await connRes.json()) as {
            connection?: { client_id?: string }
          }
          const clientId = connJson.connection?.client_id
          if (clientId) {
            const clientRes = await fetch(
              `${rpc}/ibc/core/client/v1/client_states/${encodeURIComponent(clientId)}`
            )
            if (clientRes.ok) {
              const clientJson = (await clientRes.json()) as Record<string, unknown>
              counterpartyChainId = findChainId(clientJson)
            }
          }
        }
      }

      const entry: CacheEntry = {
        counterpartyChainId,
        counterpartyChannelId,
        expiresAt: Date.now() + this.ttlMs,
      }
      this.cache.set(this.cacheKey(chainId, channelId, portId), entry)
      await upsertChannelMapping(
        chainId,
        channelId,
        portId,
        counterpartyChainId,
        counterpartyChannelId,
        channel?.state ?? null
      )
      return entry
    } catch {
      const fallback = this.getStaticFallback(chainId, channelId)
      if (fallback) {
        this.cache.set(this.cacheKey(chainId, channelId, portId), fallback)
        await upsertChannelMapping(
          chainId,
          channelId,
          portId,
          fallback.counterpartyChainId,
          fallback.counterpartyChannelId
        )
        return fallback
      }
      return null
    }
  }
}

function findChainId(obj: unknown): string | null {
  if (typeof obj !== 'object' || obj === null) return null

  const rec = obj as Record<string, unknown>
  if (typeof rec['chain_id'] === 'string' && rec['chain_id'].length > 0) {
    return rec['chain_id']
  }

  for (const value of Object.values(rec)) {
    const nested = findChainId(value)
    if (nested) return nested
  }
  return null
}
