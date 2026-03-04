import Link from 'next/link'

const LIVE_TRACES = [
  {
    label: 'Noble linked trace',
    chain: 'noble-1',
    txHash: 'E71C09567AC9D18AAA4F926690BF51564BD70E2299A5CE5B71436C64A2125DE4',
  },
  {
    label: 'Osmosis linked trace A',
    chain: 'osmosis-1',
    txHash: '813DDA59FB3095D0B9282AC440A54FDB7CDED1A0134472A840A26A4C267F87E6',
  },
  {
    label: 'Osmosis linked trace B',
    chain: 'osmosis-1',
    txHash: '7D775EE0C74A8564025FA1D953B7A04D441024EF0DA3FF688E60BD2D96161E6F',
  },
]

function shortHash(hash: string): string {
  return `${hash.slice(0, 12)}...${hash.slice(-8)}`
}

export default function LiveTracePage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#e2e8f0]">Live Indexed Traces</h1>
        <p className="mt-2 text-sm text-[#94a3b8]">
          Click any trace to open the UI view. These are real indexed transactions from monitored chains.
        </p>
      </div>

      <div className="space-y-3">
        {LIVE_TRACES.map((t) => {
          const uiUrl = `/trace/${t.txHash}?chain=${encodeURIComponent(t.chain)}`
          const apiUrl = `https://api-ibc.188.40.64.104.sslip.io/v1/transfers/${t.txHash}?chain=${encodeURIComponent(t.chain)}`
          return (
            <div
              key={t.txHash}
              className="rounded-lg border border-[#1e1e2e] bg-[#111118] p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-[#e2e8f0]">{t.label}</p>
                  <p className="text-xs font-mono text-[#94a3b8]">
                    {t.chain} | {shortHash(t.txHash)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Link
                    href={uiUrl}
                    className="rounded-md bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-600 transition-colors"
                  >
                    Open UI
                  </Link>
                  <a
                    href={apiUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-[#94a3b8] hover:text-[#e2e8f0] transition-colors"
                  >
                    JSON
                  </a>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

