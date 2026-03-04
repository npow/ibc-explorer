import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Live Stuck & Failed IBC Transfers — IBCscan',
  description:
    'Live indexed stuck, timeout, and failed-ack IBC transfers from monitored chains.',
}

interface LiveTransfer {
  transfer_id: string
  chain_id: string
  status: 'stuck' | 'failed_ack' | 'timeout'
  src_chain_id: string
  dst_chain_id: string
  src_channel: string
  dst_channel: string
  sequence: number
  denom: string
  amount: string
  sender: string | null
  receiver: string | null
  started_at: string
  updated_at: string
  stuck_since: string | null
  tx_hash: string | null
}

interface StuckApiResponse {
  count: number
  items: LiveTransfer[]
}

const API_BASE =
  process.env.NEXT_PUBLIC_DECODER_URL ?? 'http://localhost:3001'

function statusStyle(status: LiveTransfer['status']): string {
  if (status === 'stuck') return 'border-red-500/30 bg-red-500/10 text-red-400'
  if (status === 'failed_ack') {
    return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400'
  }
  return 'border-gray-500/30 bg-gray-500/10 text-gray-300'
}

function short(value: string | null, start = 12, end = 6): string {
  if (!value) return '—'
  if (value.length <= start + end + 1) return value
  return `${value.slice(0, start)}…${value.slice(-end)}`
}

function formatAge(iso: string | null): string {
  if (!iso) return '—'
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.max(0, Math.floor(diffMs / 60000))
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  if (hrs < 24) return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`
  const days = Math.floor(hrs / 24)
  const h = hrs % 24
  return h > 0 ? `${days}d ${h}h` : `${days}d`
}

async function fetchLiveTransfers(): Promise<LiveTransfer[]> {
  const url = `${API_BASE}/v1/transfers/stuck?limit=60`

  try {
    const res = await fetch(url, { next: { revalidate: 20 } })
    if (!res.ok) return []
    const json = (await res.json()) as StuckApiResponse
    return Array.isArray(json.items) ? json.items : []
  } catch {
    return []
  }
}

export default async function StuckPage() {
  const transfers = await fetchLiveTransfers()

  return (
    <div className="space-y-10">
      <div className="max-w-3xl">
        <div className="mb-3 flex items-center gap-2">
          <div className="h-px flex-1 bg-[#1e1e2e] max-w-8" />
          <span className="text-xs uppercase tracking-widest text-[#475569]">
            live index
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[#e2e8f0] sm:text-3xl">
          Live Stuck &amp; Failed IBC Transfers
        </h1>
        <p className="mt-2 text-sm text-[#94a3b8]">
          Real indexed data from monitored chains. Refreshes automatically.
        </p>
      </div>

      <div className="flex items-center gap-3 text-xs">
        <span className="rounded border border-[#1e1e2e] bg-[#111118] px-3 py-1 text-[#94a3b8]">
          {transfers.length} live cases
        </span>
      </div>

      {transfers.length === 0 ? (
        <div className="rounded-lg border border-[#1e1e2e] bg-[#111118] p-5 text-sm text-[#94a3b8]">
          No stuck/failed/timeout transfers found yet for current indexed window.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {transfers.map((t) => {
            const traceHref = t.tx_hash
              ? `/trace/${t.tx_hash}?chain=${encodeURIComponent(t.chain_id)}`
              : '#'

            return (
              <div
                key={t.transfer_id}
                className="rounded-lg border border-[#1e1e2e] bg-[#111118] p-5 flex flex-col gap-4"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${statusStyle(
                      t.status
                    )}`}
                  >
                    {t.status}
                  </span>
                  <span className="font-mono text-xs text-[#94a3b8] bg-[#0a0a0f] border border-[#1e1e2e] px-2 py-0.5 rounded">
                    {t.denom}
                  </span>
                </div>

                <div className="space-y-1 text-xs text-[#94a3b8]">
                  <p>
                    <span className="text-[#475569]">path </span>
                    <span className="font-mono text-[#e2e8f0]">
                      {t.src_chain_id} -&gt; {t.dst_chain_id}
                    </span>
                  </p>
                  <p>
                    <span className="text-[#475569]">sequence </span>
                    <span className="font-mono text-[#e2e8f0]">{t.sequence}</span>
                  </p>
                  <p>
                    <span className="text-[#475569]">amount </span>
                    <span className="font-mono text-[#e2e8f0]">{t.amount}</span>
                  </p>
                  <p>
                    <span className="text-[#475569]">age </span>
                    <span className="font-mono text-[#e2e8f0]">
                      {formatAge(t.stuck_since ?? t.updated_at)}
                    </span>
                  </p>
                </div>

                <div className="rounded bg-[#0a0a0f] border border-[#1e1e2e] px-3 py-2 text-[11px] text-[#94a3b8] space-y-1">
                  <p>
                    <span className="text-[#475569]">sender </span>
                    <span className="font-mono">{short(t.sender)}</span>
                  </p>
                  <p>
                    <span className="text-[#475569]">receiver </span>
                    <span className="font-mono">{short(t.receiver)}</span>
                  </p>
                </div>

                {t.tx_hash ? (
                  <Link
                    href={traceHref}
                    className="inline-flex items-center justify-center rounded-md border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-400 hover:bg-indigo-500/20 transition-colors"
                  >
                    View Live Trace
                  </Link>
                ) : (
                  <span className="text-xs text-[#475569] font-mono">tx unavailable</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
