import { describe, it, expect } from '@jest/globals'
import { parsePacketEvent } from '../parser.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TX_HASH     = 'ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890'
const BLOCK_HEIGHT = 10_000_000
const BLOCK_TIME   = new Date('2024-01-15T12:00:00Z')
const CHAIN_ID     = 'osmosis-1'

/** Base attributes shared by all send/recv/ack events */
function baseAttributes(overrides: Record<string, string> = {}): Array<{ key: string; value: string }> {
  const defaults: Record<string, string> = {
    packet_src_channel:       'channel-0',
    packet_dst_channel:       'channel-141',
    packet_src_port:          'transfer',
    packet_dst_port:          'transfer',
    packet_sequence:          '12345',
    packet_channel_ordering:  'ORDER_UNORDERED',
    packet_connection:        'connection-1',
    packet_timeout_height:    '1-20000000',
    packet_timeout_timestamp: '1699999999000000000',
    packet_data: JSON.stringify({
      denom:    'uosmo',
      amount:   '1000000',
      sender:   'osmo1abc123',
      receiver: 'cosmos1xyz789',
    }),
  }
  return Object.entries({ ...defaults, ...overrides }).map(([key, value]) => ({ key, value }))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('parsePacketEvent', () => {
  it('parses a valid send_packet event and returns a correct IBCPacketEvent', () => {
    const result = parsePacketEvent(
      'send_packet',
      baseAttributes(),
      TX_HASH,
      BLOCK_HEIGHT,
      BLOCK_TIME,
      CHAIN_ID
    )

    expect(result).not.toBeNull()
    expect(result!.direction).toBe('send')
    expect(result!.chain_id).toBe(CHAIN_ID)
    expect(result!.channel_id).toBe('channel-0')   // src channel for send
    expect(result!.src_channel).toBe('channel-0')
    expect(result!.dst_channel).toBe('channel-141')
    expect(result!.sequence).toBe(12345)
    expect(result!.denom).toBe('uosmo')
    expect(result!.amount).toBe('1000000')
    expect(result!.sender).toBe('osmo1abc123')
    expect(result!.receiver).toBe('cosmos1xyz789')
    expect(result!.tx_hash).toBe(TX_HASH)
    expect(result!.block_height).toBe(BLOCK_HEIGHT)
    expect(result!.block_time).toEqual(BLOCK_TIME)
    // Osmosis is source → src_chain_id is CHAIN_ID, dst resolved from channel registry
    expect(result!.src_chain_id).toBe(CHAIN_ID)
    expect(result!.dst_chain_id).toBe('cosmoshub-4')
    expect(result!.ack_success).toBeUndefined()
  })

  it('parses acknowledge_packet with success ack (AQ==) → ack_success = true', () => {
    const attrs = baseAttributes({
      packet_ack: JSON.stringify({ result: 'AQ==' }),
    })

    const result = parsePacketEvent(
      'acknowledge_packet',
      attrs,
      TX_HASH,
      BLOCK_HEIGHT,
      BLOCK_TIME,
      CHAIN_ID
    )

    expect(result).not.toBeNull()
    expect(result!.direction).toBe('ack')
    expect(result!.ack_success).toBe(true)
  })

  it('parses acknowledge_packet with error ack → ack_success = false', () => {
    const attrs = baseAttributes({
      packet_ack: JSON.stringify({ error: 'ABCI code: 5' }),
    })

    const result = parsePacketEvent(
      'acknowledge_packet',
      attrs,
      TX_HASH,
      BLOCK_HEIGHT,
      BLOCK_TIME,
      CHAIN_ID
    )

    expect(result).not.toBeNull()
    expect(result!.direction).toBe('ack')
    expect(result!.ack_success).toBe(false)
  })

  it('returns null gracefully when packet_data is missing', () => {
    const attrs = baseAttributes().filter((a) => a.key !== 'packet_data')

    const result = parsePacketEvent(
      'send_packet',
      attrs,
      TX_HASH,
      BLOCK_HEIGHT,
      BLOCK_TIME,
      CHAIN_ID
    )

    expect(result).toBeNull()
  })

  it('handles multi-hop IBC denom (path contains slashes) without error', () => {
    const multiHopDenom =
      'transfer/channel-208/transfer/channel-0/uatom'

    const attrs = baseAttributes({
      packet_data: JSON.stringify({
        denom:    multiHopDenom,
        amount:   '500000',
        sender:   'osmo1sender',
        receiver: 'cosmos1receiver',
      }),
    })

    const result = parsePacketEvent(
      'send_packet',
      attrs,
      TX_HASH,
      BLOCK_HEIGHT,
      BLOCK_TIME,
      CHAIN_ID
    )

    expect(result).not.toBeNull()
    expect(result!.denom).toBe(multiHopDenom)
    expect(result!.amount).toBe('500000')
  })

  it('parses very large amounts as string without precision loss', () => {
    // 1 trillion uosmo — would overflow a JS float
    const largeAmount = '1000000000000000000'

    const attrs = baseAttributes({
      packet_data: JSON.stringify({
        denom:    'uosmo',
        amount:   largeAmount,
        sender:   'osmo1whale',
        receiver: 'cosmos1whale',
      }),
    })

    const result = parsePacketEvent(
      'send_packet',
      attrs,
      TX_HASH,
      BLOCK_HEIGHT,
      BLOCK_TIME,
      CHAIN_ID
    )

    expect(result).not.toBeNull()
    // Must be exactly the original string — no float rounding
    expect(result!.amount).toBe(largeAmount)
  })
})
