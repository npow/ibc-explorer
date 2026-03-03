import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import PacketTimeline from '@/components/PacketTimeline'
import { STUCK_PACKETS } from '@/data/stuck-packets'

interface Props {
  params: { id: string }
}

export function generateStaticParams() {
  return STUCK_PACKETS.map((p) => ({ id: p.id }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const packet = STUCK_PACKETS.find((p) => p.id === params.id)
  if (!packet) return { title: 'Not found — IBCscan' }
  return {
    title: `${packet.title} — IBCscan`,
    description: packet.description,
  }
}

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-500/10 text-red-400 border-red-500/30',
  warning: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  resolved: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
}

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-red-500 animate-pulse',
  warning: 'bg-yellow-500',
  resolved: 'bg-gray-500',
}

function truncateAddress(addr: string): string {
  if (addr.length <= 24) return addr
  return `${addr.slice(0, 16)}…${addr.slice(-8)}`
}

export default function StuckDetailPage({ params }: Props) {
  const packet = STUCK_PACKETS.find((p) => p.id === params.id)

  if (!packet) notFound()

  return (
    <div className="space-y-10 max-w-3xl">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-[#475569]">
        <Link href="/" className="hover:text-[#94a3b8] transition-colors">
          IBCscan
        </Link>
        <span>/</span>
        <Link href="/stuck" className="hover:text-[#94a3b8] transition-colors">
          Stuck Packets
        </Link>
        <span>/</span>
        <span className="text-[#94a3b8] truncate max-w-xs">{packet.title}</span>
      </nav>

      {/* Header */}
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium ${
              SEVERITY_BADGE[packet.severity]
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[packet.severity]}`}
            />
            {packet.severity}
          </span>
          <span className="font-mono text-xs text-[#94a3b8] bg-[#111118] border border-[#1e1e2e] px-2 py-0.5 rounded">
            {packet.denom_display}
          </span>
          <span className="text-xs text-[#475569]">
            {packet.amount_display}
          </span>
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-[#e2e8f0] leading-snug">
          {packet.title}
        </h1>
        <p className="mt-2 text-sm text-[#94a3b8] leading-relaxed max-w-2xl">
          {packet.description}
        </p>

        {/* Meta strip */}
        <div className="mt-5 flex flex-wrap gap-6 text-sm">
          <div>
            <span className="text-xs text-[#475569]">stuck duration</span>
            <p className="font-mono font-medium text-[#e2e8f0]">
              {packet.stuck_duration_display}
            </p>
          </div>
          <div>
            <span className="text-xs text-[#475569]">hops in path</span>
            <p className="font-mono font-medium text-[#e2e8f0]">
              {packet.hops.length}
            </p>
          </div>
        </div>
      </div>

      {/* Addresses */}
      <div className="rounded-lg border border-[#1e1e2e] bg-[#111118] px-5 py-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#475569]">
          Transfer Parties
        </h2>
        <div className="space-y-3">
          <AddressRow label="sender" address={packet.sender} />
          <div className="flex items-center gap-2 pl-16">
            <div className="h-px flex-1 bg-[#1e1e2e]" />
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M3 7h8M8 4l3 3-3 3" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="h-px flex-1 bg-[#1e1e2e]" />
          </div>
          <AddressRow label="receiver" address={packet.receiver} />
        </div>
      </div>

      {/* Timeline */}
      <div>
        <h2 className="mb-5 text-base font-semibold text-[#e2e8f0]">
          Packet Timeline
        </h2>
        <PacketTimeline hops={packet.hops} />
      </div>

      {/* Diagnosis */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-[#e2e8f0]">
          Diagnosis
        </h2>
        <div className="rounded-lg border border-[#1e1e2e] bg-[#0a0a0f] px-5 py-4">
          <pre className="whitespace-pre-wrap font-mono text-xs text-[#94a3b8] leading-relaxed">
            {packet.diagnosis}
          </pre>
        </div>
      </div>

      {/* Resolution */}
      {packet.resolution && (
        <div>
          <h2 className="mb-3 text-base font-semibold text-[#e2e8f0]">
            Resolution
          </h2>
          <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 px-5 py-4">
            <pre className="whitespace-pre-wrap font-mono text-xs text-[#94a3b8] leading-relaxed">
              {packet.resolution}
            </pre>
          </div>
        </div>
      )}

      {/* Back link */}
      <div className="pt-2">
        <Link
          href="/stuck"
          className="inline-flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M11 7H3M6 4L3 7l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          All stuck packets
        </Link>
      </div>
    </div>
  )
}

function AddressRow({ label, address }: { label: string; address: string }) {
  return (
    <div className="flex items-baseline gap-4">
      <span className="w-16 flex-shrink-0 text-[10px] uppercase tracking-widest text-[#475569]">
        {label}
      </span>
      <span
        className="font-mono text-xs text-[#e2e8f0] break-all"
        title={address}
      >
        {address}
      </span>
    </div>
  )
}
