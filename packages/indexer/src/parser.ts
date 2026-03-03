import type { IBCPacketEvent } from './types.js'
import { resolveCounterparty } from './channels.js'

type SupportedEventType =
  | 'send_packet'
  | 'recv_packet'
  | 'acknowledge_packet'
  | 'timeout_packet'

type Direction = IBCPacketEvent['direction']

const EVENT_TYPE_TO_DIRECTION: Record<SupportedEventType, Direction> = {
  send_packet:        'send',
  recv_packet:        'recv',
  acknowledge_packet: 'ack',
  timeout_packet:     'timeout',
}

interface PacketData {
  denom?: string
  amount?: string
  sender?: string
  receiver?: string
}

function parsePacketData(raw: string): PacketData {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const obj = parsed as Record<string, unknown>
    const result: PacketData = {}
    if (typeof obj['denom'] === 'string')    result.denom    = obj['denom']
    if (typeof obj['amount'] === 'string')   result.amount   = obj['amount']
    if (typeof obj['sender'] === 'string')   result.sender   = obj['sender']
    if (typeof obj['receiver'] === 'string') result.receiver = obj['receiver']
    return result
  } catch {
    return {}
  }
}

function decodeAckSuccess(packetAck: string): boolean | undefined {
  // packetAck is a JSON string, possibly base64-encoded itself
  // Two common shapes:
  //   {"result":"AQ=="}  → success (base64 of 0x01)
  //   {"error":"..."}    → failure
  try {
    const parsed: unknown = JSON.parse(packetAck)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const obj = parsed as Record<string, unknown>

    if ('result' in obj) {
      // Any "result" key means success; the canonical success payload is base64(0x01) = "AQ=="
      return true
    }
    if ('error' in obj) {
      return false
    }
    return undefined
  } catch {
    return undefined
  }
}

export function parsePacketEvent(
  eventType: SupportedEventType,
  attributes: Array<{ key: string; value: string }>,
  txHash: string,
  blockHeight: number,
  blockTime: Date,
  chainId: string
): IBCPacketEvent | null {
  // Build a flat attribute map for quick lookup
  const attrs: Record<string, string> = {}
  for (const attr of attributes) {
    attrs[attr.key] = attr.value
  }

  const srcChannel = attrs['packet_src_channel']
  const dstChannel = attrs['packet_dst_channel']
  const srcPort    = attrs['packet_src_port']    ?? 'transfer'
  const sequenceRaw = attrs['packet_sequence']

  // Required fields — bail out if missing
  if (!srcChannel || !dstChannel || !sequenceRaw) {
    return null
  }

  const sequence = parseInt(sequenceRaw, 10)
  if (isNaN(sequence)) {
    return null
  }

  // Resolve chain IDs from channel registry.
  // For send/ack/timeout the src channel belongs to Osmosis; for recv the dst channel does.
  let srcChainId: string
  let dstChainId: string

  if (eventType === 'recv_packet') {
    // Osmosis is receiving — dst channel is the Osmosis-side channel
    const counterparty = resolveCounterparty(dstChannel)
    srcChainId = counterparty?.chain_id ?? 'unknown'
    dstChainId = chainId
  } else {
    // Osmosis is sending (send/ack/timeout) — src channel is the Osmosis-side channel
    const counterparty = resolveCounterparty(srcChannel)
    srcChainId = chainId
    dstChainId = counterparty?.chain_id ?? 'unknown'
  }

  // Parse packet_data for transfer details
  const packetDataRaw = attrs['packet_data']
  if (!packetDataRaw) {
    return null
  }
  const packetData = parsePacketData(packetDataRaw)

  const denom  = packetData.denom  ?? ''
  const amount = packetData.amount ?? '0'

  if (!denom) {
    return null
  }

  const direction = EVENT_TYPE_TO_DIRECTION[eventType]

  const event: IBCPacketEvent = {
    chain_id:     chainId,
    channel_id:   eventType === 'recv_packet' ? dstChannel : srcChannel,
    port_id:      srcPort,
    sequence,
    direction,
    tx_hash:      txHash,
    block_height: blockHeight,
    block_time:   blockTime,
    src_chain_id: srcChainId,
    dst_chain_id: dstChainId,
    src_channel:  srcChannel,
    dst_channel:  dstChannel,
    denom,
    amount,
    raw_event:    attrs,
  }

  if (packetData.sender)   event.sender   = packetData.sender
  if (packetData.receiver) event.receiver = packetData.receiver

  // Decode acknowledgement result for ack events
  if (eventType === 'acknowledge_packet' && attrs['packet_ack']) {
    const ackSuccess = decodeAckSuccess(attrs['packet_ack'])
    if (ackSuccess !== undefined) {
      event.ack_success = ackSuccess
    }
  }

  return event
}
