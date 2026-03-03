import type { PacketHop } from '@/data/stuck-packets'

interface PacketTimelineProps {
  hops: PacketHop[]
}

const STATUS_COLORS: Record<PacketHop['status'], string> = {
  completed: '#22c55e',
  stuck: '#ef4444',
  timeout: '#6b7280',
  failed_ack: '#f97316',
}

const STATUS_BG: Record<PacketHop['status'], string> = {
  completed: 'bg-green-500/10 text-green-400 border-green-500/30',
  stuck: 'bg-red-500/10 text-red-400 border-red-500/30',
  timeout: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
  failed_ack: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
}

const EVENT_LABELS: Record<PacketHop['event'], string> = {
  send_packet: 'send_packet',
  recv_packet: 'recv_packet',
  acknowledge_packet: 'acknowledge_packet',
  timeout_packet: 'timeout_packet',
  write_acknowledgement: 'write_acknowledgement',
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

function formatTime(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toISOString().replace('T', ' ').replace('.000Z', ' UTC')
}

function truncateHash(hash: string, chars = 8): string {
  if (!hash) return '—'
  return `${hash.slice(0, chars)}…${hash.slice(-4)}`
}

function mintscanUrl(chainId: string, txHash: string): string {
  const chainMap: Record<string, string> = {
    'cosmoshub-4': 'cosmos',
    'osmosis-1': 'osmosis',
    'neutron-1': 'neutron',
    'noble-1': 'noble',
    'injective-1': 'injective',
    'stride-1': 'stride',
  }
  const chain = chainMap[chainId] ?? chainId
  return `https://mintscan.io/${chain}/tx/${txHash}`
}

export default function PacketTimeline({ hops }: PacketTimelineProps) {
  const lastIndex = hops.length - 1

  return (
    <div className="space-y-0">
      {hops.map((hop, i) => {
        const isLast = i === lastIndex
        const color = STATUS_COLORS[hop.status]
        const isStuck = hop.status === 'stuck'
        const isPending = hop.status === 'stuck' && hop.block_height === 0

        return (
          <div key={hop.step} className="flex gap-4">
            {/* Left: dot + connector line */}
            <div className="flex flex-col items-center" style={{ width: 20, flexShrink: 0 }}>
              {/* Dot */}
              <div className="relative mt-1 flex-shrink-0" style={{ zIndex: 1 }}>
                <div
                  className={isStuck ? 'animate-pulse' : ''}
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    backgroundColor: color,
                    boxShadow: isStuck ? `0 0 0 4px ${color}33` : undefined,
                    opacity: isPending ? 0.5 : 1,
                  }}
                />
              </div>
              {/* Connector line */}
              {!isLast && (
                <div
                  style={{
                    width: 2,
                    flex: 1,
                    minHeight: 32,
                    marginTop: 2,
                    marginBottom: 2,
                    backgroundColor:
                      hop.status === 'completed' ? '#22c55e40' : '#ef444430',
                    borderLeft:
                      hop.status !== 'completed'
                        ? '2px dashed #6b728050'
                        : undefined,
                    borderRight: 'none',
                    borderTop: 'none',
                    borderBottom: 'none',
                    background:
                      hop.status === 'completed' ? '#22c55e30' : 'none',
                  }}
                />
              )}
            </div>

            {/* Right: content */}
            <div
              className={`mb-6 flex-1 rounded-lg border border-[#1e1e2e] bg-[#111118] p-4 ${
                isStuck ? 'border-red-500/30' : ''
              }`}
            >
              {/* Top row: chain + event badge + elapsed */}
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-[#e2e8f0]">
                  {hop.chain_name}
                </span>
                <span className="text-xs text-[#475569]">{hop.chain_id}</span>

                <span
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium ${STATUS_BG[hop.status]}`}
                >
                  {hop.status}
                </span>

                <span className="rounded bg-[#0a0a0f] border border-[#2a2a3e] px-1.5 py-0.5 font-mono text-[10px] text-[#94a3b8]">
                  {EVENT_LABELS[hop.event]}
                </span>

                {hop.elapsed_ms !== undefined && (
                  <span className="ml-auto text-xs text-[#475569]">
                    +{formatElapsed(hop.elapsed_ms)} since prev
                  </span>
                )}
              </div>

              {/* Channel info */}
              <div className="mb-2 flex flex-wrap gap-3 text-xs text-[#94a3b8]">
                <span>
                  <span className="text-[#475569]">src channel </span>
                  <span className="font-mono text-[#e2e8f0]">{hop.channel_id}</span>
                </span>
                <span className="text-[#2a2a3e]">→</span>
                <span>
                  <span className="text-[#475569]">dst channel </span>
                  <span className="font-mono text-[#e2e8f0]">{hop.counterparty_channel_id}</span>
                </span>
              </div>

              {/* Block + time */}
              <div className="mb-2 flex flex-wrap gap-4 text-xs text-[#94a3b8]">
                {hop.block_height > 0 ? (
                  <span>
                    <span className="text-[#475569]">block </span>
                    <span className="font-mono text-[#e2e8f0]">
                      {hop.block_height.toLocaleString()}
                    </span>
                  </span>
                ) : (
                  <span className="font-mono text-[#475569]">block pending</span>
                )}
                {hop.block_time && (
                  <span className="font-mono text-[#475569]">{formatTime(hop.block_time)}</span>
                )}
              </div>

              {/* Tx hash */}
              {hop.tx_hash ? (
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[10px] text-[#475569]">tx</span>
                  <a
                    href={mintscanUrl(hop.chain_id, hop.tx_hash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition-colors"
                    title={hop.tx_hash}
                  >
                    {truncateHash(hop.tx_hash, 12)}
                  </a>
                </div>
              ) : (
                <div className="mt-1">
                  <span className="font-mono text-xs text-[#475569] italic">
                    tx not yet submitted
                  </span>
                </div>
              )}

              {/* Stuck note */}
              {isStuck && (
                <div className="mt-3 rounded bg-red-500/5 border border-red-500/20 px-3 py-2">
                  <p className="text-xs text-red-400">
                    This packet has not been received. The relayer appears to be offline.
                  </p>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
