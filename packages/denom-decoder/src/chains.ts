export interface ChainInfo {
  lcdUrl: string
  name: string
}

export const chains: Record<string, ChainInfo> = {
  'osmosis-1': {
    lcdUrl: 'https://lcd.osmosis.zone',
    name: 'Osmosis',
  },
  'cosmoshub-4': {
    lcdUrl: 'https://api.cosmos.network',
    name: 'Cosmos Hub',
  },
  'neutron-1': {
    lcdUrl: 'https://rest-neutron.ecostake.com',
    name: 'Neutron',
  },
  'injective-1': {
    lcdUrl: 'https://lcd.injective.network',
    name: 'Injective',
  },
  'stride-1': {
    lcdUrl: 'https://stride-api.polkachu.com',
    name: 'Stride',
  },
  'noble-1': {
    lcdUrl: 'https://noble-api.polkachu.com',
    name: 'Noble',
  },
  'celestia': {
    lcdUrl: 'https://celestia-api.polkachu.com',
    name: 'Celestia',
  },
  'dydx-mainnet-1': {
    lcdUrl: 'https://dydx-api.polkachu.com',
    name: 'dYdX',
  },
  'stargaze-1': {
    lcdUrl: 'https://stargaze-api.polkachu.com',
    name: 'Stargaze',
  },
  'juno-1': {
    lcdUrl: 'https://juno-api.polkachu.com',
    name: 'Juno',
  },
  'akash-network': {
    lcdUrl: 'https://akash-api.polkachu.com',
    name: 'Akash',
  },
  'kaiyo-1': {
    lcdUrl: 'https://kujira-api.polkachu.com',
    name: 'Kujira',
  },
}

/**
 * Returns a human-readable chain name for a given chain_id.
 * Falls back to the chain_id itself if the chain is not in the map.
 */
export function getChainName(chainId: string): string {
  return chains[chainId]?.name ?? chainId
}
