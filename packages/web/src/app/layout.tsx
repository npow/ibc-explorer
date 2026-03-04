import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'IBCscan — IBC Transfer Explorer',
  description:
    'Trace multi-hop IBC transfers, decode denom hashes, and find stuck packets across Cosmos chains.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased">
        <header className="border-b border-[#1e1e2e] bg-[#0a0a0f]">
          <div className="mx-auto max-w-6xl px-6 py-4">
            <nav className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Link
                  href="/"
                  className="flex items-center gap-2 text-[#e2e8f0] hover:text-white transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <div className="h-5 w-5 rounded-sm bg-indigo-500 flex items-center justify-center">
                      <div className="h-2.5 w-2.5 rounded-full border-2 border-white/80" />
                    </div>
                    <span className="text-base font-semibold tracking-tight">IBCscan</span>
                  </div>
                </Link>
                <span className="rounded border border-indigo-500/40 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-mono font-medium uppercase tracking-widest text-indigo-400">
                  alpha
                </span>
              </div>

              <div className="flex items-center gap-1">
                <Link
                  href="/stuck"
                  className="rounded-md px-3 py-1.5 text-sm text-[#94a3b8] hover:bg-[#111118] hover:text-[#e2e8f0] transition-colors"
                >
                  Stuck Packets
                </Link>
                <Link
                  href="/trace/demo"
                  className="rounded-md px-3 py-1.5 text-sm text-[#94a3b8] hover:bg-[#111118] hover:text-[#e2e8f0] transition-colors"
                >
                  Explorer
                </Link>
              </div>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 py-10">
          {children}
        </main>

        <footer className="border-t border-[#1e1e2e] mt-20">
          <div className="mx-auto max-w-6xl px-6 py-6">
            <p className="text-xs text-[#475569]">
              IBCscan — IBC Transfer Explorer &mdash; alpha build &mdash; live indexed data where available
            </p>
          </div>
        </footer>
      </body>
    </html>
  )
}
