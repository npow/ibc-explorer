import Link from 'next/link'

interface Props {
  searchParams: { page?: string }
}

interface LiveLinkedItem {
  chain_id: string
  tx_hash: string
  linked_transfers: number
  last_seen_at: string
}

interface LiveLinkedResponse {
  page: number
  limit: number
  total: number
  total_pages: number
  items: LiveLinkedItem[]
}

const API_BASE =
  process.env.NEXT_PUBLIC_DECODER_URL ?? 'http://localhost:3001'

function shortHash(hash: string): string {
  return `${hash.slice(0, 12)}...${hash.slice(-8)}`
}

async function fetchLiveLinked(page: number): Promise<LiveLinkedResponse | null> {
  const url = `${API_BASE}/v1/transfers/live-linked?page=${page}&limit=15`
  try {
    const res = await fetch(url, { next: { revalidate: 15 } })
    if (!res.ok) return null
    return (await res.json()) as LiveLinkedResponse
  } catch {
    return null
  }
}

export default async function LiveTracePage({ searchParams }: Props) {
  const pageRaw = Number(searchParams.page ?? '1')
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1
  const data = await fetchLiveLinked(page)
  const items = data?.items ?? []
  const totalPages = data?.total_pages ?? 1

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#e2e8f0]">Live Indexed Traces</h1>
        <p className="mt-2 text-sm text-[#94a3b8]">
          Click any trace to open the UI view. This list updates from the latest indexed linked transfers.
        </p>
      </div>

      <div className="space-y-3">
        {items.length === 0 && (
          <div className="rounded-lg border border-[#1e1e2e] bg-[#111118] p-4 text-sm text-[#94a3b8]">
            No linked traces found yet.
          </div>
        )}
        {items.map((t) => {
          const uiUrl = `/trace/${t.tx_hash}?chain=${encodeURIComponent(t.chain_id)}`
          const apiUrl = `https://api-ibc.188.40.64.104.sslip.io/v1/transfers/${t.tx_hash}?chain=${encodeURIComponent(t.chain_id)}`
          return (
            <div
              key={`${t.chain_id}-${t.tx_hash}`}
              className="rounded-lg border border-[#1e1e2e] bg-[#111118] p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-[#e2e8f0]">{t.chain_id}</p>
                  <p className="text-xs font-mono text-[#94a3b8]">
                    {shortHash(t.tx_hash)} | linked {t.linked_transfers}
                  </p>
                  <p className="text-xs text-[#475569]">
                    {new Date(t.last_seen_at).toISOString()}
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

      <div className="flex items-center justify-between pt-1">
        <Link
          href={`/trace/live?page=${Math.max(1, page - 1)}`}
          className={`rounded border border-[#1e1e2e] px-3 py-1.5 text-xs ${
            page <= 1
              ? 'pointer-events-none text-[#475569]'
              : 'text-[#94a3b8] hover:text-[#e2e8f0]'
          }`}
        >
          Previous
        </Link>
        <p className="text-xs text-[#94a3b8]">
          Page {page} / {Math.max(1, totalPages)}
        </p>
        <Link
          href={`/trace/live?page=${Math.min(totalPages, page + 1)}`}
          className={`rounded border border-[#1e1e2e] px-3 py-1.5 text-xs ${
            page >= totalPages
              ? 'pointer-events-none text-[#475569]'
              : 'text-[#94a3b8] hover:text-[#e2e8f0]'
          }`}
        >
          Next
        </Link>
      </div>
    </div>
  )
}
