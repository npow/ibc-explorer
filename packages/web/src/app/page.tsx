import Link from 'next/link'
import DenomDecoder from '@/components/DenomDecoder'
import StuckPacketCard from '@/components/StuckPacketCard'
import { STUCK_PACKETS } from '@/data/stuck-packets'

interface LiveLinkedItem {
  chain_id: string
  tx_hash: string
  linked_transfers: number
  last_seen_at: string
}

interface LiveLinkedResponse {
  items: LiveLinkedItem[]
}

const API_BASE =
  process.env.NEXT_PUBLIC_DECODER_URL ?? 'http://localhost:3001'

function shortHash(hash: string): string {
  return `${hash.slice(0, 12)}...${hash.slice(-8)}`
}

async function fetchLiveLinks(): Promise<LiveLinkedItem[]> {
  const url = `${API_BASE}/v1/transfers/live-linked?page=1&limit=3`
  try {
    const res = await fetch(url, { next: { revalidate: 15 } })
    if (!res.ok) return []
    const json = (await res.json()) as LiveLinkedResponse
    return json.items ?? []
  } catch {
    return []
  }
}

export default async function HomePage() {
  const liveLinks = await fetchLiveLinks()

  return (
    <div className="space-y-20">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="pt-8 pb-4">
        <div className="max-w-2xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#1e1e2e] bg-[#111118] px-3 py-1">
            <div className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
            <span className="text-xs text-[#94a3b8]">
              IBC packet explorer — alpha
            </span>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-[#e2e8f0] sm:text-4xl">
            Find exactly where your
            <br />
            <span className="text-indigo-400">IBC transfer got stuck</span>
          </h1>

          <p className="mt-5 text-base text-[#94a3b8] leading-relaxed max-w-xl">
            Inter-Blockchain Communication transfers hop across multiple chains
            and relayers. When a packet goes missing, standard block explorers
            show only one chain at a time — leaving you with half the story.
            IBCscan traces the full path, identifies the failing hop, and tells
            you what to do about it.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/stuck"
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600 transition-colors"
            >
              Browse stuck packets
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <a
              href="#decode"
              className="inline-flex items-center gap-1.5 rounded-md border border-[#1e1e2e] bg-[#111118] px-4 py-2 text-sm font-medium text-[#94a3b8] hover:text-[#e2e8f0] hover:border-[#2a2a3e] transition-colors"
            >
              Decode a denom hash
            </a>
          </div>
        </div>

        {/* Stats strip */}
        <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-6">
          {[
            { label: 'Chains indexed', value: '52+', sub: 'Cosmos ecosystem' },
            { label: 'Channels tracked', value: '200+', sub: 'active IBC channels' },
            { label: 'Denom cache', value: '1,400+', sub: 'resolved IBC denoms' },
            { label: 'Stuck cases', value: '3', sub: 'documented with RCA' },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-lg border border-[#1e1e2e] bg-[#111118] px-4 py-3"
            >
              <p className="font-mono text-2xl font-semibold text-indigo-400">{s.value}</p>
              <p className="mt-0.5 text-xs font-medium text-[#e2e8f0]">{s.label}</p>
              <p className="text-xs text-[#475569]">{s.sub}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-6 flex items-baseline justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[#e2e8f0]">Live indexed traces</h2>
            <p className="mt-1 text-sm text-[#94a3b8]">
              Real transactions you can open directly in the trace UI.
            </p>
          </div>
          <Link
            href="/trace/live"
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1"
          >
            View trace list
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {liveLinks.map((t) => (
            <Link
              key={`${t.chain_id}-${t.tx_hash}`}
              href={`/trace/${t.tx_hash}?chain=${encodeURIComponent(t.chain_id)}`}
              className="rounded-lg border border-[#1e1e2e] bg-[#111118] p-4 hover:border-[#2a2a3e] transition-colors"
            >
              <p className="text-sm font-medium text-[#e2e8f0]">{t.chain_id}</p>
              <p className="mt-1 text-xs font-mono text-[#94a3b8]">{shortHash(t.tx_hash)}</p>
              <p className="mt-1 text-xs text-[#475569]">linked {t.linked_transfers}</p>
            </Link>
          ))}
          {liveLinks.length === 0 && (
            <div className="rounded-lg border border-[#1e1e2e] bg-[#111118] p-4 text-sm text-[#94a3b8]">
              No live linked traces available yet.
            </div>
          )}
        </div>
      </section>

      {/* ── Denom decoder ────────────────────────────────────────────────── */}
      <section id="decode">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-[#e2e8f0]">
            Decode any IBC denom hash
          </h2>
          <p className="mt-1 text-sm text-[#94a3b8]">
            Resolve an{' '}
            <span className="font-mono text-[#e2e8f0]">ibc/HASH</span> to its
            base token, origin chain, and transfer route.
          </p>
        </div>

        <div className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-6">
          <DenomDecoder />
        </div>
      </section>

      {/* ── Recent stuck packets ─────────────────────────────────────────── */}
      <section>
        <div className="mb-6 flex items-baseline justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[#e2e8f0]">
              Recent stuck packets
            </h2>
            <p className="mt-1 text-sm text-[#94a3b8]">
              Documented cases with root cause analysis and resolution status.
            </p>
          </div>
          <Link
            href="/stuck"
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1"
          >
            View all
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STUCK_PACKETS.map((packet) => (
            <StuckPacketCard key={packet.id} packet={packet} />
          ))}
        </div>
      </section>
    </div>
  )
}
