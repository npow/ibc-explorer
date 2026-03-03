import { describe, it, expect, beforeAll, afterEach, jest } from '@jest/globals'
import { initCache } from '../cache.js'
import { decode, parsePath } from '../decoder.js'

// ---------------------------------------------------------------------------
// Bootstrap an in-memory SQLite database so tests are isolated and fast.
// ---------------------------------------------------------------------------
beforeAll(() => {
  initCache(':memory:')
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Helper: build a minimal successful LCD response body.
// ---------------------------------------------------------------------------
function makeLcdResponse(tracePath: string, baseDenom: string): Response {
  return new Response(
    JSON.stringify({
      denom_trace: {
        path: tracePath,
        base_denom: baseDenom,
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parsePath', () => {
  it('parses a single-hop path into one hop', () => {
    const hops = parsePath('transfer/channel-0')
    expect(hops).toHaveLength(1)
    expect(hops[0]).toEqual({ channel: 'channel-0', port: 'transfer' })
  })

  it('parses a multi-hop path into two hops', () => {
    const hops = parsePath('transfer/channel-141/transfer/channel-0')
    expect(hops).toHaveLength(2)
    expect(hops[0]).toEqual({ channel: 'channel-141', port: 'transfer' })
    expect(hops[1]).toEqual({ channel: 'channel-0', port: 'transfer' })
  })
})

describe('decode', () => {
  const ATOM_DENOM = 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2'

  it('resolves a single-hop denom from a live LCD node', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(makeLcdResponse('transfer/channel-0', 'uatom'))

    const result = await decode(ATOM_DENOM, 'osmosis-1')

    expect(result.denom).toBe(ATOM_DENOM)
    expect(result.chain_id).toBe('osmosis-1')
    expect(result.path).toBe('transfer/channel-0')
    expect(result.base_denom).toBe('uatom')
    expect(result.hops).toHaveLength(1)
    expect(result.hops[0]).toEqual({ channel: 'channel-0', port: 'transfer' })
    expect(result.resolved_from).toBe('live_node')
    expect(result.cached_at).toBeUndefined()
  })

  it('returns resolved_from: cache on a repeat lookup (cache hit)', async () => {
    // The previous test already cached ATOM_DENOM on osmosis-1, so fetch
    // should NOT be called again.
    const fetchSpy = jest.spyOn(global, 'fetch')

    const result = await decode(ATOM_DENOM, 'osmosis-1')

    expect(result.resolved_from).toBe('cache')
    expect(result.cached_at).toBeDefined()
    expect(typeof result.cached_at).toBe('string')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('parses a multi-hop path correctly when fetched from LCD', async () => {
    const multiHopDenom =
      'ibc/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        makeLcdResponse('transfer/channel-141/transfer/channel-0', 'uosmo')
      )

    const result = await decode(multiHopDenom, 'cosmoshub-4')

    expect(result.hops).toHaveLength(2)
    expect(result.hops[0]).toEqual({ channel: 'channel-141', port: 'transfer' })
    expect(result.hops[1]).toEqual({ channel: 'channel-0', port: 'transfer' })
    expect(result.resolved_from).toBe('live_node')
  })

  it('throws a clear error when the LCD returns 404 (unknown denom)', async () => {
    const unknownDenom =
      'ibc/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'

    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('{"message":"not found"}', {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await expect(decode(unknownDenom, 'osmosis-1')).rejects.toThrow(
      /was not found on chain/
    )
  })

  it('throws a clear error for an unknown chain', async () => {
    await expect(
      decode(ATOM_DENOM, 'not-a-real-chain-99')
    ).rejects.toThrow(/Unknown chain/)
  })

  it('throws a clear error when denom does not start with ibc/', async () => {
    await expect(decode('uatom', 'osmosis-1')).rejects.toThrow(
      /must start with ibc\//
    )
  })
})
