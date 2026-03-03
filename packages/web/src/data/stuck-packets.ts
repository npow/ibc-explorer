export interface PacketHop {
  step: number
  status: 'completed' | 'stuck' | 'timeout' | 'failed_ack'
  chain_id: string
  chain_name: string
  block_height: number
  block_time: string // ISO 8601
  tx_hash: string
  event:
    | 'send_packet'
    | 'recv_packet'
    | 'acknowledge_packet'
    | 'timeout_packet'
    | 'write_acknowledgement'
  channel_id: string
  counterparty_channel_id: string
  elapsed_ms?: number // time since previous hop
}

export interface StuckPacket {
  id: string
  title: string
  description: string
  severity: 'critical' | 'warning' | 'resolved'
  denom_display: string // e.g. "ATOM" or "USDC.noble"
  amount_display: string // e.g. "1,000 ATOM"
  sender: string
  receiver: string
  hops: PacketHop[]
  diagnosis: string // human-readable explanation of what went wrong
  resolution?: string // what the user should do
  stuck_duration_display: string // e.g. "8 hours 23 minutes"
}

export const STUCK_PACKETS: StuckPacket[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // Case 1: ATOM transfer stuck on dead relayer channel (resolved via timeout)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'atom-dead-relayer-channel-141',
    title: 'ATOM transfer stuck on dead relayer channel',
    description:
      'A 1,000 ATOM transfer from Cosmos Hub to Osmosis via channel-141 was never relayed after the assigned relayer went offline. The packet timed out automatically and funds were returned.',
    severity: 'resolved',
    denom_display: 'ATOM',
    amount_display: '1,000 ATOM',
    sender: 'cosmos1qyqa2zn5c925a9ezrvealn7p6k3t4uheaqyfe9',
    receiver: 'osmo1qyqa2zn5c925a9ezrvealn7p6k3t4uheaqyfe9',
    stuck_duration_display: '8 hours 23 minutes',
    diagnosis:
      'The relayer assigned to channel-141 (cosmos1 → Osmosis channel-0) went offline at approximately block 19,450,010 on Cosmos Hub. No other relayer was configured to pick up packets on this channel at the time. The packet\'s timeout_height was set to Osmosis block 12,800,000, which was reached after 8 hours and 23 minutes of idle time.\n\nPacket sequence: 84729\nTimeout height: Osmosis block 12,800,000\nRelayer last active: cosmos1 block 19,450,008',
    resolution:
      'Resolved automatically. The timeout_packet transaction was submitted on Cosmos Hub at block 19,480,412, and 1,000 ATOM was refunded to the original sender address. No user action was required. Users in similar situations can accelerate resolution by submitting the timeout_packet message themselves once the counterparty chain has passed the timeout height.',
    hops: [
      {
        step: 1,
        status: 'completed',
        chain_id: 'cosmoshub-4',
        chain_name: 'Cosmos Hub',
        block_height: 19450000,
        block_time: '2024-11-15T14:23:00Z',
        tx_hash:
          'A3F2B891C4D5E6F7890A1B2C3D4E5F60718293A4B5C6D7E8F9012345678901AB',
        event: 'send_packet',
        channel_id: 'channel-141',
        counterparty_channel_id: 'channel-0',
      },
      {
        step: 2,
        status: 'timeout',
        chain_id: 'cosmoshub-4',
        chain_name: 'Cosmos Hub',
        block_height: 19480412,
        block_time: '2024-11-15T22:46:00Z',
        tx_hash:
          'F1E2D3C4B5A6978869504132CDEF0123456789ABCDEF0123456789ABCDEF0123',
        event: 'timeout_packet',
        channel_id: 'channel-141',
        counterparty_channel_id: 'channel-0',
        elapsed_ms: 30180000, // 8h 23m
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Case 2: Multi-hop USDC stuck at final hop (critical — unresolved)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'usdc-multihop-neutron-stuck',
    title: 'Multi-hop USDC stuck at final hop (Noble → Osmosis → Neutron)',
    description:
      '50,000 USDC.noble was successfully bridged from Noble to Osmosis, but the second hop to Neutron via Osmosis channel-874 was never relayed. Funds are locked in-transit.',
    severity: 'critical',
    denom_display: 'USDC.noble',
    amount_display: '50,000 USDC',
    sender: 'noble1xp8zr6yjn79fhyahrqxjqnelqkfkq3zdwxy8ph',
    receiver: 'neutron1xp8zr6yjn79fhyahrqxjqnelqkfkq3zdwxy8ph',
    stuck_duration_display: '2 hours 11 minutes',
    diagnosis:
      'The Noble → Osmosis leg completed successfully at Osmosis block 13,204,881. The IBC denom on Osmosis after the first hop is:\n\nibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA84\n\nThe second hop from Osmosis to Neutron uses channel-874. This channel currently has a single active relayer operator (Lavender.Five). That relayer went offline at Osmosis block 13,204,950, leaving 47 pending unrelayed packets on the channel.\n\nTimeout height for this packet: Neutron block 8,550,000\nEstimated time until client expiry: ~4 hours from time of writing\nPending packets on channel-874: 47',
    resolution:
      'Option 1 (preferred): Contact Lavender.Five or Neutron validator set relayer operators via the Neutron Discord to restart the channel-874 relayer. Most operators respond within 30–60 minutes.\n\nOption 2: After the timeout height is reached on Neutron, the sender can submit a timeout_packet transaction on Osmosis to reclaim the USDC on Osmosis. The funds will then need to be re-bridged to Neutron.\n\nDo NOT attempt to send a second transfer — this will not help and will create a second stuck packet.',
    hops: [
      {
        step: 1,
        status: 'completed',
        chain_id: 'noble-1',
        chain_name: 'Noble',
        block_height: 5882100,
        block_time: '2024-11-20T09:14:00Z',
        tx_hash:
          '2C3D4E5F60718293A4B5C6D7E8F90123456789ABCDEF0123456789ABCDEF0145',
        event: 'send_packet',
        channel_id: 'channel-750',
        counterparty_channel_id: 'channel-1',
      },
      {
        step: 2,
        status: 'completed',
        chain_id: 'osmosis-1',
        chain_name: 'Osmosis',
        block_height: 13204881,
        block_time: '2024-11-20T09:15:22Z',
        tx_hash:
          '7E8F90123456789ABCDEF0123456789ABCDEF01234567891B2C3D4E5F6071829',
        event: 'recv_packet',
        channel_id: 'channel-1',
        counterparty_channel_id: 'channel-750',
        elapsed_ms: 82000, // ~82 seconds
      },
      {
        step: 3,
        status: 'completed',
        chain_id: 'osmosis-1',
        chain_name: 'Osmosis',
        block_height: 13204885,
        block_time: '2024-11-20T09:15:32Z',
        tx_hash:
          '9ABCDEF0123456789ABCDEF0123456789ABCDEF012345678929A3F2B891C4D5E',
        event: 'send_packet',
        channel_id: 'channel-874',
        counterparty_channel_id: 'channel-10',
        elapsed_ms: 10000,
      },
      {
        step: 4,
        status: 'stuck',
        chain_id: 'neutron-1',
        chain_name: 'Neutron',
        block_height: 0,
        block_time: '',
        tx_hash: '',
        event: 'recv_packet',
        channel_id: 'channel-10',
        counterparty_channel_id: 'channel-874',
        elapsed_ms: 7860000, // 2h 11m and counting
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Case 3: Failed acknowledgement — funds safe (warning)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'osmo-failed-ack-callback',
    title: 'Failed acknowledgement — funds safe on destination',
    description:
      '500 OSMO was successfully received on Cosmos Hub, but the acknowledgement callback on Osmosis encountered a module account conflict, producing an ack error. The transfer itself succeeded.',
    severity: 'warning',
    denom_display: 'OSMO',
    amount_display: '500 OSMO',
    sender: 'osmo1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0abc1def',
    receiver: 'cosmos1abc2def3ghi4jkl5mno6pqr7stu8vwx9yz0abc1',
    stuck_duration_display: 'N/A — funds safe',
    diagnosis:
      'The packet was sent from Osmosis at block 13,180,442 and successfully received on Cosmos Hub at block 21,003,117. A write_acknowledgement was emitted on Cosmos Hub and relayed back to Osmosis.\n\nHowever, the acknowledgement contained an error payload:\n\n  {"error":"ABCI code: 5: error handling packet: see events for details"}\n\nInvestigation revealed the receiver address (cosmos1abc2...) had its incoming funds immediately re-staked by the Stride liquid staking module via an ICA callback. This callback ran before the IBC acknowledgement callback, causing a module account state conflict when the ack tried to read the account balance.\n\nThis is a known edge case in Cosmos SDK v0.47 with ICS-20 + ICA interaction. The error is cosmetic — the receiver holds the OSMO tokens on Cosmos Hub.',
    resolution:
      'No action required. The 500 OSMO is in the receiver\'s account on Cosmos Hub. The "ack error" status displayed by some block explorers (e.g., Mintscan) is misleading in this case — it refers to the callback failure, not the token transfer.\n\nIf you are building tooling: check for ICS-20 error acks by inspecting the acknowledgement bytes directly rather than relying on explorer status labels.',
    hops: [
      {
        step: 1,
        status: 'completed',
        chain_id: 'osmosis-1',
        chain_name: 'Osmosis',
        block_height: 13180442,
        block_time: '2024-11-18T17:02:15Z',
        tx_hash:
          'B5C6D7E8F9012345678901AB2C3D4E5F60718293A4B5C6D7E8F901234567891C',
        event: 'send_packet',
        channel_id: 'channel-0',
        counterparty_channel_id: 'channel-141',
      },
      {
        step: 2,
        status: 'completed',
        chain_id: 'cosmoshub-4',
        chain_name: 'Cosmos Hub',
        block_height: 21003117,
        block_time: '2024-11-18T17:03:44Z',
        tx_hash:
          'D8E9F0123456789ABCDEF0123456789ABCDEF01234567890AB2C3D4E5F607182',
        event: 'recv_packet',
        channel_id: 'channel-141',
        counterparty_channel_id: 'channel-0',
        elapsed_ms: 89000,
      },
      {
        step: 3,
        status: 'completed',
        chain_id: 'cosmoshub-4',
        chain_name: 'Cosmos Hub',
        block_height: 21003118,
        block_time: '2024-11-18T17:03:50Z',
        tx_hash:
          'E9F0123456789ABCDEF0123456789ABCDEF01234567890ABC2D3E4F506172839',
        event: 'write_acknowledgement',
        channel_id: 'channel-141',
        counterparty_channel_id: 'channel-0',
        elapsed_ms: 6000,
      },
      {
        step: 4,
        status: 'failed_ack',
        chain_id: 'osmosis-1',
        chain_name: 'Osmosis',
        block_height: 13180509,
        block_time: '2024-11-18T17:04:28Z',
        tx_hash:
          'F0123456789ABCDEF0123456789ABCDEF01234567890ABCDE3F4A5B6C7D8E9F0',
        event: 'acknowledge_packet',
        channel_id: 'channel-0',
        counterparty_channel_id: 'channel-141',
        elapsed_ms: 38000,
      },
    ],
  },
]
