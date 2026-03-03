'use client'

import { useState, useCallback } from 'react'

const DECODER_URL =
  process.env.NEXT_PUBLIC_DECODER_URL ?? 'http://localhost:3001'

const SUPPORTED_CHAINS = [
  { id: 'osmosis-1', label: 'Osmosis' },
  { id: 'cosmoshub-4', label: 'Cosmos Hub' },
  { id: 'neutron-1', label: 'Neutron' },
  { id: 'noble-1', label: 'Noble' },
  { id: 'injective-1', label: 'Injective' },
  { id: 'stride-1', label: 'Stride' },
]

interface DecodeResult {
  input_denom: string
  base_denom: string
  origin_chain: string
  hop_path: string[]
  resolved_from: 'cache' | 'live'
  trace?: string
}

type State =
  | { type: 'idle' }
  | { type: 'loading' }
  | { type: 'success'; data: DecodeResult }
  | { type: 'error'; message: string }

export default function DenomDecoder() {
  const [denom, setDenom] = useState('')
  const [chainId, setChainId] = useState('osmosis-1')
  const [state, setState] = useState<State>({ type: 'idle' })

  const handleDecode = useCallback(async () => {
    const trimmed = denom.trim()
    if (!trimmed) return

    setState({ type: 'loading' })

    try {
      const url = `${DECODER_URL}/decode?denom=${encodeURIComponent(trimmed)}&chain_id=${encodeURIComponent(chainId)}`
      const res = await fetch(url)

      if (!res.ok) {
        const text = await res.text()
        let message = `HTTP ${res.status}`
        try {
          const json = JSON.parse(text)
          message = json.error ?? json.message ?? message
        } catch {
          // use raw text if not JSON
          if (text.length < 200) message = text
        }
        setState({ type: 'error', message })
        return
      }

      const data: DecodeResult = await res.json()
      setState({ type: 'success', data })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Network error — is the decoder service running?'
      setState({ type: 'error', message })
    }
  }, [denom, chainId])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') handleDecode()
    },
    [handleDecode]
  )

  const handleReset = () => {
    setDenom('')
    setState({ type: 'idle' })
  }

  const isLoading = state.type === 'loading'

  return (
    <div className="space-y-4">
      {/* Input row */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <input
            type="text"
            value={denom}
            onChange={(e) => setDenom(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA84"
            disabled={isLoading}
            className="w-full rounded-md border border-[#1e1e2e] bg-[#0a0a0f] px-4 py-2.5 font-mono text-sm text-[#e2e8f0] placeholder-[#334155] outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-colors disabled:opacity-50"
          />
        </div>

        <select
          value={chainId}
          onChange={(e) => setChainId(e.target.value)}
          disabled={isLoading}
          className="rounded-md border border-[#1e1e2e] bg-[#0a0a0f] px-3 py-2.5 text-sm text-[#e2e8f0] outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-colors disabled:opacity-50 sm:w-44"
        >
          {SUPPORTED_CHAINS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>

        <button
          onClick={handleDecode}
          disabled={isLoading || !denom.trim()}
          className="rounded-md bg-indigo-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-600 active:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors sm:w-auto w-full"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <Spinner />
              Decoding…
            </span>
          ) : (
            'Decode'
          )}
        </button>
      </div>

      {/* Hint */}
      {state.type === 'idle' && (
        <p className="text-xs text-[#475569]">
          Paste any{' '}
          <span className="font-mono text-[#94a3b8]">ibc/HASH</span> denom to
          resolve the base token, origin chain, and full hop path.
        </p>
      )}

      {/* Error state */}
      {state.type === 'error' && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-red-400">Decode failed</p>
              <p className="mt-0.5 font-mono text-xs text-red-400/70">{state.message}</p>
            </div>
            <button
              onClick={handleReset}
              className="text-xs text-[#475569] hover:text-[#94a3b8] transition-colors flex-shrink-0 pt-0.5"
            >
              clear
            </button>
          </div>
        </div>
      )}

      {/* Success state */}
      {state.type === 'success' && (
        <div className="rounded-md border border-[#1e1e2e] bg-[#0a0a0f]">
          {/* Result header */}
          <div className="flex items-center justify-between border-b border-[#1e1e2e] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
              <span className="text-xs font-medium text-green-400">Decoded</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded border border-[#1e1e2e] bg-[#111118] px-2 py-0.5 font-mono text-[10px] text-[#475569]">
                {state.data.resolved_from}
              </span>
              <button
                onClick={handleReset}
                className="text-xs text-[#475569] hover:text-[#94a3b8] transition-colors"
              >
                clear
              </button>
            </div>
          </div>

          {/* Result rows */}
          <div className="divide-y divide-[#1e1e2e]">
            <ResultRow label="base denom" value={state.data.base_denom} mono />
            <ResultRow label="origin chain" value={state.data.origin_chain} mono />
            <ResultRow label="input denom" value={state.data.input_denom} mono small />
            {state.data.trace && (
              <ResultRow label="raw trace" value={state.data.trace} mono small />
            )}
            {state.data.hop_path.length > 0 && (
              <div className="px-4 py-3">
                <span className="text-[10px] uppercase tracking-widest text-[#475569]">
                  hop path
                </span>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {state.data.hop_path.map((hop, i) => (
                    <span key={i} className="flex items-center gap-1.5">
                      <span className="rounded bg-[#111118] border border-[#1e1e2e] px-2 py-0.5 font-mono text-xs text-[#e2e8f0]">
                        {hop}
                      </span>
                      {i < state.data.hop_path.length - 1 && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                          <path d="M2 5h6M6 2l3 3-3 3" stroke="#475569" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ResultRow({
  label,
  value,
  mono = false,
  small = false,
}: {
  label: string
  value: string
  mono?: boolean
  small?: boolean
}) {
  return (
    <div className="px-4 py-3">
      <span className="text-[10px] uppercase tracking-widest text-[#475569]">{label}</span>
      <p
        className={`mt-0.5 break-all ${mono ? 'font-mono' : ''} ${
          small ? 'text-xs text-[#94a3b8]' : 'text-sm text-[#e2e8f0]'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-3.5 w-3.5"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}
