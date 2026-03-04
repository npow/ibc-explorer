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
  const tryParseJson = (input: string): PacketData | null => {
    try {
      const parsed: unknown = JSON.parse(input)
      if (typeof parsed !== 'object' || parsed === null) return null
      const obj = parsed as Record<string, unknown>
      const result: PacketData = {}
      if (typeof obj['denom'] === 'string')    result.denom    = obj['denom']
      if (typeof obj['amount'] === 'string')   result.amount   = obj['amount']
      if (typeof obj['sender'] === 'string')   result.sender   = obj['sender']
      if (typeof obj['receiver'] === 'string') result.receiver = obj['receiver']
      return result
    } catch {
      return null
    }
  }

  const direct = tryParseJson(raw)
  if (direct) return direct

  // Some chains expose packet_data as base64-encoded JSON bytes.
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8')
    const fromB64 = tryParseJson(decoded)
    if (fromB64) return fromB64
  } catch {
    // ignore
  }

  return {}
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.length > 0) return v
  }
  return undefined
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

function inferCounterpartyChain(
  chainId: string,
  localChannelId: string
): string {
  // Static channel map currently covers Osmosis channels only.
  if (chainId === 'osmosis-1') {
    return resolveCounterparty(localChannelId)?.chain_id ?? 'unknown'
  }
  return 'unknown'
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

  // Resolve chain IDs.
  // For send/ack/timeout the local chain is source; for recv the local chain is destination.
  // Counterparty is inferred only when we have chain-specific channel mappings.
  let srcChainId: string
  let dstChainId: string

  if (eventType === 'recv_packet') {
    srcChainId = inferCounterpartyChain(chainId, dstChannel)
    dstChainId = chainId
  } else {
    srcChainId = chainId
    dstChainId = inferCounterpartyChain(chainId, srcChannel)
  }

  // Parse packet_data for transfer details
  const packetDataRaw = attrs['packet_data']
  if (!packetDataRaw && !attrs['packet_data_denom']) {
    return null
  }
  const packetData = packetDataRaw ? parsePacketData(packetDataRaw) : {}

  const denom = firstNonEmpty(packetData.denom, attrs['packet_data_denom']) ?? ''
  const amount =
    firstNonEmpty(packetData.amount, attrs['packet_data_amount']) ?? '0'

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

  const sender = firstNonEmpty(packetData.sender, attrs['packet_data_sender'])
  const receiver = firstNonEmpty(
    packetData.receiver,
    attrs['packet_data_receiver']
  )
  if (sender) event.sender = sender
  if (receiver) event.receiver = receiver

  // Decode acknowledgement result for ack events
  if (eventType === 'acknowledge_packet' && attrs['packet_ack']) {
    const ackSuccess = decodeAckSuccess(attrs['packet_ack'])
    if (ackSuccess !== undefined) {
      event.ack_success = ackSuccess
    }
  }

  return event
}
