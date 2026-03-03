export const OSMOSIS_CHANNELS: Record<string, { chain_id: string; chain_name: string; counterparty_channel: string }> = {
  'channel-0':   { chain_id: 'cosmoshub-4',    chain_name: 'Cosmos Hub',   counterparty_channel: 'channel-141' },
  'channel-1':   { chain_id: 'irisnet',        chain_name: 'IRISnet',      counterparty_channel: 'channel-3'   },
  'channel-6':   { chain_id: 'akash',          chain_name: 'Akash',        counterparty_channel: 'channel-1'   },
  'channel-8':   { chain_id: 'sentinel',       chain_name: 'Sentinel',     counterparty_channel: 'channel-2'   },
  'channel-42':  { chain_id: 'juno-1',         chain_name: 'Juno',         counterparty_channel: 'channel-42'  },
  'channel-72':  { chain_id: 'stargaze-1',     chain_name: 'Stargaze',     counterparty_channel: 'channel-75'  },
  'channel-122': { chain_id: 'stride-1',       chain_name: 'Stride',       counterparty_channel: 'channel-5'   },
  'channel-208': { chain_id: 'noble-1',        chain_name: 'Noble',        counterparty_channel: 'channel-1'   },
  'channel-569': { chain_id: 'neutron-1',      chain_name: 'Neutron',      counterparty_channel: 'channel-10'  },
  'channel-750': { chain_id: 'noble-1',        chain_name: 'Noble (USDC)', counterparty_channel: 'channel-1'   },
  'channel-874': { chain_id: 'dydx-mainnet-1', chain_name: 'dYdX',         counterparty_channel: 'channel-3'   },
}

export function resolveCounterparty(
  channelId: string
): { chain_id: string; chain_name: string; counterparty_channel: string } | null {
  return OSMOSIS_CHANNELS[channelId] ?? null
}
