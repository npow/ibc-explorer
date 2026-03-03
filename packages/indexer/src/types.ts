export interface IBCPacketEvent {
  chain_id: string
  channel_id: string
  port_id: string
  sequence: number
  direction: 'send' | 'recv' | 'ack' | 'timeout'
  tx_hash: string
  block_height: number
  block_time: Date
  src_chain_id: string
  dst_chain_id: string
  src_channel: string
  dst_channel: string
  sender?: string
  receiver?: string
  denom: string
  amount: string        // keep as string to avoid BigInt issues
  ack_success?: boolean
  raw_event: Record<string, string>
}

export interface ChannelCounterparty {
  chain_id: string
  channel_id: string
  port_id: string
  counterparty_chain_id: string | null
  counterparty_channel_id: string | null
}

// Tendermint WebSocket event shape
export interface TendermintWSMessage {
  jsonrpc: '2.0'
  id: number
  result: {
    query: string
    data?: {
      type: string
      value: {
        TxResult?: {
          height: string
          tx: string
          result: {
            events: Array<{
              type: string
              attributes: Array<{
                key: string
                value: string
                index: boolean
              }>
            }>
          }
        }
      }
    }
    events?: Record<string, string[]>
  }
}
