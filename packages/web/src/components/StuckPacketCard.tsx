import Link from 'next/link'
import type { StuckPacket } from '@/data/stuck-packets'

interface StuckPacketCardProps {
  packet: StuckPacket
}

const SEVERITY_BADGE: Record<StuckPacket['severity'], string> = {
  critical: 'bg-red-500/10 text-red-400 border-red-500/30',
  warning: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  resolved: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
}

const SEVERITY_DOT: Record<StuckPacket['severity'], string> = {
  critical: 'bg-red-500',
  warning: 'bg-yellow-500',
  resolved: 'bg-gray-500',
}

function truncateAddress(addr: string, chars = 12): string {
  if (addr.length <= chars * 2 + 3) return addr
  return `${addr.slice(0, chars)}…${addr.slice(-6)}`
}

export default function StuckPacketCard({ packet }: StuckPacketCardProps) {
  return (
    <div className="rounded-lg border border-[#1e1e2e] bg-[#111118] p-5 flex flex-col gap-4 hover:border-[#2a2a3e] transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium ${
              SEVERITY_BADGE[packet.severity]
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[packet.severity]} ${
                packet.severity === 'critical' ? 'animate-pulse' : ''
              }`}
            />
            {packet.severity}
          </span>
          <span className="font-mono text-xs text-[#94a3b8] bg-[#0a0a0f] border border-[#1e1e2e] px-2 py-0.5 rounded">
            {packet.denom_display}
          </span>
        </div>
      </div>

      {/* Title */}
      <div>
        <h3 className="text-sm font-semibold text-[#e2e8f0] leading-snug mb-1">
          {packet.title}
        </h3>
        <p className="text-xs text-[#94a3b8] leading-relaxed line-clamp-2">
          {packet.description}
        </p>
      </div>

      {/* Amount + duration */}
      <div className="flex items-center gap-4 text-sm">
        <div>
          <span className="text-[#475569] text-xs">amount</span>
          <p className="font-mono font-medium text-[#e2e8f0]">{packet.amount_display}</p>
        </div>
        <div className="w-px h-8 bg-[#1e1e2e]" />
        <div>
          <span className="text-[#475569] text-xs">stuck duration</span>
          <p className="font-mono text-sm text-[#e2e8f0]">{packet.stuck_duration_display}</p>
        </div>
        <div className="w-px h-8 bg-[#1e1e2e]" />
        <div>
          <span className="text-[#475569] text-xs">hops</span>
          <p className="font-mono font-medium text-[#e2e8f0]">{packet.hops.length}</p>
        </div>
      </div>

      {/* Addresses */}
      <div className="rounded bg-[#0a0a0f] border border-[#1e1e2e] px-3 py-2.5 space-y-1.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] text-[#475569] w-14 flex-shrink-0">sender</span>
          <span className="font-mono text-xs text-[#94a3b8] break-all">
            {truncateAddress(packet.sender)}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] text-[#475569] w-14 flex-shrink-0">receiver</span>
          <span className="font-mono text-xs text-[#94a3b8] break-all">
            {truncateAddress(packet.receiver)}
          </span>
        </div>
      </div>

      {/* CTA */}
      <div className="pt-1">
        <Link
          href={`/stuck/${packet.id}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-400 hover:bg-indigo-500/20 hover:text-indigo-300 transition-colors"
        >
          View Timeline
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>
    </div>
  )
}
