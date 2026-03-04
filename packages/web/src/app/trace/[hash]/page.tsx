import type { Metadata } from 'next'
import Link from 'next/link'

interface Props {
  params: { hash: string }
  searchParams: { chain?: string }
}

interface TraceEvent {
  direction: 'send' | 'recv' | 'ack' | 'timeout'
  tx_hash: string
  block_time: string
}

interface TraceHop {
  hop_index: number
  chain_id: string
  channel_id: string
  sequence: number
  src_chain_id: string
  dst_chain_id: string
  src_channel: string
  dst_channel: string
  denom: string
  amount: string
  sender: string | null
  receiver: string | null
  status: string
  started_at: string
  updated_at: string
  stuck_since: string | null
  events: TraceEvent[]
}

interface TraceResponse {
  transfer_id: string
  tx_hash: string
  chain_id: string
  status: string
  hops: TraceHop[]
  started_at: string | null
  updated_at: string | null
}

const API_BASE =
  process.env.NEXT_PUBLIC_DECODER_URL ?? 'http://localhost:3001'

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return {
    title: `Trace ${params.hash.slice(0, 12)}… — IBCscan`,
    description: 'Live IBC transfer trace from indexed packet events.',
  }
}

async function fetchTrace(hash: string, chain: string): Promise<TraceResponse | null> {
  const url = `${API_BASE}/v1/transfers/${encodeURIComponent(hash)}?chain=${encodeURIComponent(chain)}`
  try {
    const res = await fetch(url, { next: { revalidate: 10 } })
    if (!res.ok) return null
    return (await res.json()) as TraceResponse
  } catch {
    return null
  }
}

function shortHash(hash: string): string {
  if (hash.length <= 24) return hash
  return `${hash.slice(0, 16)}…${hash.slice(-8)}`
}

export default async function TracePage({ params, searchParams }: Props) {
  const hash = params.hash
  const chain = searchParams.chain ?? 'osmosis-1'
  const trace = await fetchTrace(hash, chain)

  if (!trace) {
    return (
      <div className="space-y-6 max-w-2xl">
        <h1 className="text-xl font-semibold text-[#e2e8f0]">Trace not found</h1>
        <p className="text-sm text-[#94a3b8]">
          No indexed transfer found for this tx hash on chain <span className="font-mono">{chain}</span>.
        </p>
        <Link href="/stuck" className="text-sm text-indigo-400 hover:text-indigo-300">
          Back to live stuck list
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <nav className="flex items-center gap-2 text-xs text-[#475569]">
        <Link href="/" className="hover:text-[#94a3b8] transition-colors">
          IBCscan
        </Link>
        <span>/</span>
        <Link href="/stuck" className="hover:text-[#94a3b8] transition-colors">
          Live Stuck
        </Link>
        <span>/</span>
        <span className="font-mono text-[#94a3b8]">{shortHash(hash)}</span>
      </nav>

      <div className="rounded-lg border border-[#1e1e2e] bg-[#111118] p-5 space-y-2">
        <div className="flex flex-wrap gap-3 items-center">
          <span className="rounded border border-[#1e1e2e] bg-[#0a0a0f] px-2 py-0.5 text-xs font-mono text-[#e2e8f0]">
            {trace.status}
          </span>
          <span className="text-xs text-[#94a3b8]">
            transfer <span className="font-mono">{trace.transfer_id}</span>
          </span>
        </div>
        <p className="text-xs text-[#94a3b8] break-all font-mono">{trace.tx_hash}</p>
      </div>

      <div className="space-y-4">
        {trace.hops.map((h) => (
          <div key={`${h.chain_id}-${h.sequence}-${h.hop_index}`} className="rounded-lg border border-[#1e1e2e] bg-[#111118] p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[#e2e8f0] font-semibold">Hop {h.hop_index + 1}</span>
              <span className="font-mono text-[#94a3b8]">{h.chain_id}</span>
              <span className="font-mono text-[#475569]">seq {h.sequence}</span>
              <span className="font-mono text-[#475569]">{h.src_channel} -&gt; {h.dst_channel}</span>
            </div>

            <div className="text-xs text-[#94a3b8] font-mono">
              denom {h.denom} | amount {h.amount}
            </div>

            <div className="space-y-1">
              {h.events.map((e) => (
                <div key={`${e.tx_hash}-${e.direction}`} className="text-xs text-[#94a3b8] flex flex-wrap gap-2">
                  <span className="rounded border border-[#1e1e2e] bg-[#0a0a0f] px-1.5 py-0.5 font-mono text-[#e2e8f0]">
                    {e.direction}
                  </span>
                  <span className="font-mono text-[#475569]">{new Date(e.block_time).toISOString()}</span>
                  <span className="font-mono break-all">{shortHash(e.tx_hash)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
