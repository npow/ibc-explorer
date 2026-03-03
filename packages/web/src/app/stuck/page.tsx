import type { Metadata } from 'next'
import StuckPacketCard from '@/components/StuckPacketCard'
import { STUCK_PACKETS } from '@/data/stuck-packets'

export const metadata: Metadata = {
  title: 'Stuck & Failed IBC Packets — IBCscan',
  description:
    'Historical IBC packet failures with root cause analysis, hop-by-hop timelines, and resolution status.',
}

export default function StuckPage() {
  const critical = STUCK_PACKETS.filter((p) => p.severity === 'critical')
  const warning = STUCK_PACKETS.filter((p) => p.severity === 'warning')
  const resolved = STUCK_PACKETS.filter((p) => p.severity === 'resolved')

  return (
    <div className="space-y-12">
      {/* Page header */}
      <div className="max-w-2xl">
        <div className="mb-3 flex items-center gap-2">
          <div className="h-px flex-1 bg-[#1e1e2e] max-w-8" />
          <span className="text-xs uppercase tracking-widest text-[#475569]">
            packet failures
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[#e2e8f0] sm:text-3xl">
          Stuck &amp; Failed IBC Packets
        </h1>
        <p className="mt-2 text-sm text-[#94a3b8]">
          Historical cases with root cause analysis.
        </p>
      </div>

      {/* Explainer */}
      <div className="rounded-lg border border-[#1e1e2e] bg-[#111118] px-5 py-4 max-w-2xl">
        <p className="text-sm text-[#94a3b8] leading-relaxed">
          When an IBC packet is sent but never acknowledged, funds appear to
          vanish. The sender's chain debits the tokens immediately on
          <code className="mx-1 rounded bg-[#0a0a0f] px-1.5 py-0.5 font-mono text-xs text-[#e2e8f0]">
            send_packet
          </code>
          — but if no relayer delivers it to the destination, and no timeout
          is submitted, the tokens are locked indefinitely. Here are
          documented cases with diagnosis and resolution status.
        </p>
      </div>

      {/* Summary counts */}
      <div className="flex flex-wrap gap-3">
        <SeverityPill
          severity="critical"
          count={critical.length}
          label="critical"
        />
        <SeverityPill
          severity="warning"
          count={warning.length}
          label="warning"
        />
        <SeverityPill
          severity="resolved"
          count={resolved.length}
          label="resolved"
        />
        <span className="flex items-center rounded border border-[#1e1e2e] bg-[#111118] px-3 py-1 text-xs text-[#475569]">
          {STUCK_PACKETS.length} total cases
        </span>
      </div>

      {/* Critical */}
      {critical.length > 0 && (
        <section>
          <SectionHeading
            label="Critical"
            description="Active packet failures — funds at risk or stuck in transit."
            dotClass="bg-red-500 animate-pulse"
          />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {critical.map((p) => (
              <StuckPacketCard key={p.id} packet={p} />
            ))}
          </div>
        </section>
      )}

      {/* Warning */}
      {warning.length > 0 && (
        <section>
          <SectionHeading
            label="Warning"
            description="Partial failures or misleading error states — review recommended."
            dotClass="bg-yellow-500"
          />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {warning.map((p) => (
              <StuckPacketCard key={p.id} packet={p} />
            ))}
          </div>
        </section>
      )}

      {/* Resolved */}
      {resolved.length > 0 && (
        <section>
          <SectionHeading
            label="Resolved"
            description="Historical cases that have been fully resolved."
            dotClass="bg-gray-500"
          />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {resolved.map((p) => (
              <StuckPacketCard key={p.id} packet={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function SectionHeading({
  label,
  description,
  dotClass,
}: {
  label: string
  description: string
  dotClass: string
}) {
  return (
    <div className="flex items-start gap-3 border-b border-[#1e1e2e] pb-3">
      <div className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${dotClass}`} />
      <div>
        <h2 className="text-sm font-semibold text-[#e2e8f0]">{label}</h2>
        <p className="text-xs text-[#475569]">{description}</p>
      </div>
    </div>
  )
}

function SeverityPill({
  severity,
  count,
  label,
}: {
  severity: 'critical' | 'warning' | 'resolved'
  count: number
  label: string
}) {
  const styles = {
    critical: 'border-red-500/30 bg-red-500/10 text-red-400',
    warning: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400',
    resolved: 'border-gray-500/30 bg-gray-500/10 text-gray-400',
  }
  return (
    <span
      className={`flex items-center gap-1.5 rounded border px-3 py-1 text-xs font-medium ${styles[severity]}`}
    >
      <span className="font-mono font-bold">{count}</span> {label}
    </span>
  )
}
