import type { Metadata } from 'next'
import Link from 'next/link'

interface Props {
  params: { hash: string }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return {
    title: `Trace ${params.hash.slice(0, 12)}… — IBCscan`,
    description: 'Live IBC packet trace — coming soon.',
  }
}

export default function TracePage({ params }: Props) {
  const { hash } = params
  const isDemoHash = hash === 'demo'

  return (
    <div className="space-y-10 max-w-2xl">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-[#475569]">
        <Link href="/" className="hover:text-[#94a3b8] transition-colors">
          IBCscan
        </Link>
        <span>/</span>
        <span className="text-[#94a3b8]">trace</span>
        <span>/</span>
        <span className="font-mono text-[#94a3b8] truncate max-w-xs">
          {isDemoHash ? 'demo' : `${hash.slice(0, 16)}…`}
        </span>
      </nav>

      {/* Tx hash display */}
      {!isDemoHash && (
        <div className="rounded-lg border border-[#1e1e2e] bg-[#111118] px-5 py-4">
          <p className="text-[10px] uppercase tracking-widest text-[#475569] mb-1.5">
            transaction hash
          </p>
          <p className="font-mono text-sm text-[#e2e8f0] break-all">{hash}</p>
        </div>
      )}

      {/* Coming soon card */}
      <div className="rounded-xl border border-[#1e1e2e] bg-[#111118] px-6 py-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-[#1e1e2e] bg-[#0a0a0f]">
          <svg
            width="22"
            height="22"
            viewBox="0 0 22 22"
            fill="none"
            aria-hidden
          >
            <circle cx="11" cy="11" r="9" stroke="#475569" strokeWidth="1.5" />
            <path
              d="M11 7v4.5l3 1.5"
              stroke="#6366f1"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h1 className="text-lg font-semibold text-[#e2e8f0]">
          Live packet tracing
        </h1>
        <p className="mt-2 text-sm text-[#94a3b8] leading-relaxed max-w-md mx-auto">
          Live packet tracing is coming in the next release. The indexer will
          subscribe to IBC events across 52+ chains in real time, enabling
          per-transaction trace views with full hop-by-hop timelines.
        </p>

        <div className="mt-6 rounded-lg border border-[#1e1e2e] bg-[#0a0a0f] px-4 py-3 text-left max-w-sm mx-auto">
          <p className="text-xs text-[#475569] mb-2 uppercase tracking-widest">
            Planned for Week 3-4
          </p>
          <ul className="space-y-1.5 text-xs text-[#94a3b8]">
            {[
              'Real-time WebSocket event indexing',
              'Per-packet hop graph with latency',
              'Relayer attribution per channel',
              'Stuck packet auto-detection + alerts',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <div className="mt-1 h-1 w-1 rounded-full bg-indigo-500 flex-shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-6 text-sm text-[#94a3b8]">
          In the meantime, browse our documented stuck packet cases.
        </p>

        <div className="mt-4 flex justify-center gap-3">
          <Link
            href="/stuck"
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600 transition-colors"
          >
            Browse stuck packets
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md border border-[#1e1e2e] bg-[#0a0a0f] px-4 py-2 text-sm font-medium text-[#94a3b8] hover:text-[#e2e8f0] transition-colors"
          >
            Back home
          </Link>
        </div>
      </div>
    </div>
  )
}
