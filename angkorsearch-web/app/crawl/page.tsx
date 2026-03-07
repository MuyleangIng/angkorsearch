'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/AuthContext'
import ThemeToggle from '@/components/ui/ThemeToggle'

// ── Types ─────────────────────────────────────────────────────────────────────
type LogType = 'info' | 'ok' | 'warn' | 'error' | 'system' | 'wait' | 'done'

interface LogLine {
  id:   number
  type: LogType
  msg:  string
  ts:   string
}

// ── Terminal line colors ───────────────────────────────────────────────────────
const LINE_STYLE: Record<LogType, string> = {
  info:   'text-[#9ec6f3]',
  ok:     'text-[#5af78e]',
  warn:   'text-[#f4f99d]',
  error:  'text-[#ff5c57]',
  system: 'text-[#6272a4]',
  wait:   'text-[#abb2bf] italic',
  done:   'text-[#5af78e] font-bold',
}
const PREFIX: Record<LogType, string> = {
  info:   '  →',
  ok:     '  ✓',
  warn:   '  ⚠',
  error:  '  ✗',
  system: '   ',
  wait:   '  …',
  done:   '  ✓',
}

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour12: false })
  } catch { return '' }
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function CrawlPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (authLoading) return
    if (!user) router.push('/login?next=/crawl')
    else if (user.role !== 'admin') router.push('/')
  }, [user, authLoading, router])

  const [url,     setUrl]     = useState('')
  const [running, setRunning] = useState(false)
  const [lines,   setLines]   = useState<LogLine[]>([])
  const [done,    setDone]    = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef  = useRef<AbortController | null>(null)
  const lineIdRef = useRef(0)

  // Auto-scroll to bottom whenever new lines arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  const addLine = useCallback((type: LogType, msg: string, ts?: string) => {
    setLines(prev => [...prev, {
      id:   lineIdRef.current++,
      type,
      msg,
      ts:   ts ?? new Date().toISOString(),
    }])
  }, [])

  async function startCrawl() {
    const trimmed = url.trim()
    if (!trimmed) return

    // Reset
    setLines([])
    setDone(false)
    setRunning(true)
    lineIdRef.current = 0

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await fetch(`/api/crawl-stream?url=${encodeURIComponent(trimmed)}`, {
        signal: ctrl.signal,
        cache:  'no-store',
      })

      if (!res.body) throw new Error('No response body')
      const reader = res.body.getReader()
      const dec    = new TextDecoder()
      let   buf    = ''

      while (true) {
        const { value, done: streamDone } = await reader.read()
        if (streamDone) break

        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''

        for (const part of parts) {
          const dataLine = part.split('\n').find(l => l.startsWith('data: '))
          if (!dataLine) continue
          try {
            const ev = JSON.parse(dataLine.slice(6))
            addLine(ev.type as LogType, ev.msg, ev.ts)
            if (ev.done) {
              setDone(true)
              setRunning(false)
            }
          } catch { /* malformed SSE line, skip */ }
        }
      }
    } catch (e: unknown) {
      if ((e as Error)?.name !== 'AbortError') {
        addLine('error', `Stream error: ${(e as Error).message ?? e}`)
      }
    } finally {
      setRunning(false)
    }
  }

  function stopCrawl() {
    abortRef.current?.abort()
    addLine('warn', 'Stream cancelled by user.')
    setRunning(false)
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !running) startCrawl()
  }

  if (authLoading || !user || user.role !== 'admin') return null

  return (
    <div className="min-h-screen bg-primary text-content flex flex-col">

      {/* Header */}
      <header className="bg-card border-b border-border px-4 sm:px-6 py-3 flex items-center gap-4 sticky top-0 z-40">
        <Link href="/" className="opacity-70 hover:opacity-100 transition-opacity flex-shrink-0">
          <img src="/logo.png" alt="AngkorSearch" className="h-8 w-auto" />
        </Link>
        <div>
          <h1 className="text-sm font-bold text-content leading-tight">Force Crawler</h1>
          <p className="text-muted text-xs">Live crawl any URL with real-time log stream</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/admin" className="text-xs text-muted hover:text-content border border-border px-3 py-1.5 rounded-full hover:border-blue/50 transition-all">
            Admin Panel
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 px-4 sm:px-6 py-6 max-w-5xl mx-auto w-full space-y-5">

        {/* URL input */}
        <section className="bg-card border border-border rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-content mb-1">Target URL</h2>
          <p className="text-xs text-muted mb-4">
            Directly fetches, parses and indexes any URL right now — <span className="text-green font-bold">no queue wait</span>. Page is searchable within seconds of completion.
          </p>

          <div className="flex gap-3">
            <div className="relative flex-1">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={handleKey}
                placeholder="https://muyleanging.com/blog/post"
                disabled={running}
                className="w-full bg-primary border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-content placeholder:text-muted focus:outline-none focus:border-blue disabled:opacity-50 transition-colors"
              />
            </div>

            {running ? (
              <button
                onClick={stopCrawl}
                className="flex items-center gap-2 bg-red/10 border border-red/30 text-red text-sm font-medium px-5 py-2.5 rounded-xl hover:bg-red/20 transition-all flex-shrink-0"
              >
                <span className="w-2 h-2 rounded-full bg-red animate-pulse" />
                Stop
              </button>
            ) : (
              <button
                onClick={startCrawl}
                disabled={!url.trim()}
                className="flex items-center gap-2 bg-blue text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-blue/90 disabled:opacity-50 transition-all flex-shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Run Crawl
              </button>
            )}
          </div>

          {/* Quick examples */}
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="text-xs text-muted">Examples:</span>
            {[
              'https://muyleanging.com',
              'https://khmertimeskh.com',
              'https://phnompenhpost.com',
            ].map(ex => (
              <button
                key={ex}
                onClick={() => setUrl(ex)}
                disabled={running}
                className="text-xs text-blue hover:underline disabled:opacity-40"
              >
                {ex}
              </button>
            ))}
          </div>
        </section>

        {/* Terminal window */}
        <section className="rounded-2xl overflow-hidden border border-border shadow-2xl shadow-black/40">
          {/* Terminal title bar */}
          <div className="bg-[#1e1e2e] border-b border-white/10 px-4 py-2.5 flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
              <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
              <span className="w-3 h-3 rounded-full bg-[#28c840]" />
            </div>
            <span className="text-xs text-[#6272a4] font-mono ml-2 flex items-center gap-2">
              angkorsearch — force-crawler
              {running && (
                <span className="flex gap-1">
                  {[0,1,2].map(i => (
                    <span key={i} className="w-1.5 h-1.5 rounded-full bg-[#5af78e] animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />
                  ))}
                </span>
              )}
            </span>
            {lines.length > 0 && (
              <button
                onClick={() => { setLines([]); setDone(false) }}
                disabled={running}
                className="ml-auto text-[10px] text-[#6272a4] hover:text-[#9ec6f3] transition-colors disabled:opacity-30"
              >
                clear
              </button>
            )}
          </div>

          {/* Log output */}
          <div className="bg-[#1a1b2e] min-h-[400px] max-h-[560px] overflow-y-auto p-4 font-mono text-[13px] leading-6">

            {lines.length === 0 && !running && (
              <div className="flex flex-col items-center justify-center h-64 gap-3">
                <svg className="w-10 h-10 text-[#6272a4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-[#6272a4] text-sm">Enter a URL above and click <span className="text-[#9ec6f3]">Run Crawl</span></p>
              </div>
            )}

            {lines.map(line => (
              <div key={line.id} className="flex gap-3 group">
                {/* Timestamp */}
                <span className="text-[#44475a] flex-shrink-0 select-none text-[11px] mt-[1px]">
                  {fmtTime(line.ts)}
                </span>
                {/* Prefix icon */}
                <span className={`flex-shrink-0 select-none w-5 ${LINE_STYLE[line.type]}`}>
                  {PREFIX[line.type]}
                </span>
                {/* Message */}
                <span className={LINE_STYLE[line.type]}>
                  {line.msg}
                </span>
              </div>
            ))}

            {/* Blinking cursor while running */}
            {running && (
              <div className="flex gap-3 mt-1">
                <span className="text-[#44475a] text-[11px] select-none">{fmtTime(new Date().toISOString())}</span>
                <span className="text-[#6272a4] select-none w-5">   </span>
                <span className="text-[#9ec6f3] animate-pulse">█</span>
              </div>
            )}

            {/* Done banner */}
            {done && (
              <div className="mt-4 border border-[#5af78e]/30 bg-[#5af78e]/5 rounded-xl px-4 py-3 flex items-center gap-3">
                <svg className="w-5 h-5 text-[#5af78e] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-[#5af78e] text-sm font-semibold">Crawl complete</p>
                  <Link
                    href={`/search?q=${encodeURIComponent(url)}&tab=all`}
                    className="text-[#9ec6f3] text-xs hover:underline"
                  >
                    Search for this URL on AngkorSearch →
                  </Link>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Status bar */}
          <div className="bg-[#1e1e2e] border-t border-white/10 px-4 py-1.5 flex items-center justify-between">
            <span className="text-[11px] text-[#6272a4] font-mono">
              {running ? (
                <span className="text-[#febc2e]">● running</span>
              ) : done ? (
                <span className="text-[#5af78e]">● done</span>
              ) : (
                <span>● idle</span>
              )}
            </span>
            <span className="text-[11px] text-[#6272a4] font-mono">{lines.length} lines</span>
          </div>
        </section>

        {/* How it works */}
        <section className="bg-card border border-border rounded-2xl p-5 text-sm">
          <h3 className="font-semibold text-content mb-3 flex items-center gap-2">
            <svg className="w-4 h-4 text-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            How Force Crawl works
          </h3>
          <ol className="space-y-2 text-muted list-none">
            {[
              ['Direct fetch', 'The API server fetches the URL immediately using libcurl — no queue wait, no crawler dependency.'],
              ['HTML parsing', 'Title, meta description, language and full text are extracted from the raw HTML response.'],
              ['Language detection', 'Checks for Khmer Unicode characters (U+1780–U+17FF) to auto-detect km vs en.'],
              ['PostgreSQL upsert', 'Page is saved (or updated if already indexed) in the pages table with full-text search index.'],
              ['Background queue', 'URL is also pushed to the crawler at P0 so outbound links are discovered and crawled in the background.'],
            ].map(([title, desc], i) => (
              <li key={i} className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-blue/10 text-blue text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <span><strong className="text-content">{title}</strong> — {desc}</span>
              </li>
            ))}
          </ol>
        </section>

      </main>
    </div>
  )
}
