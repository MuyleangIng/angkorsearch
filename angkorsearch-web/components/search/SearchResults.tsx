'use client'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Skeleton from '@/components/ui/Skeleton'
import WebResult from '@/components/results/WebResult'
import NewsResult from '@/components/results/NewsResult'
import ImageResult from '@/components/results/ImageResult'
import VideoResult from '@/components/results/VideoResult'
import GithubResult from '@/components/results/GithubResult'
import AIOverview from '@/components/widgets/AIOverview'
import TopResult from '@/components/widgets/TopResult'
import PeopleAlsoAsk from '@/components/widgets/PeopleAlsoAsk'
import Pagination from '@/components/search/Pagination'
import { useSearch } from '@/hooks/useSearch'
import { useBookmark } from '@/hooks/useBookmark'
import { fetchSearch } from '@/lib/api'
import type { TabId, SearchResult } from '@/types'

interface Props {
  query:      string
  tab:        TabId
  page:       number
  lang:       string
  onResults?: (results: SearchResult[]) => void
}

// ── Web Discovery — auto-crawls when search returns 0 results ────────────────
type DiscoveryLine = { id: number; type: string; msg: string; url?: string; title?: string }

function WebDiscovery({ query, onRefresh }: { query: string; onRefresh: () => void }) {
  const [lines,   setLines]   = useState<DiscoveryLine[]>([])
  const [status,  setStatus]  = useState<'running' | 'found' | 'none' | 'broad'>('running')
  const [count,   setCount]   = useState(0)
  const [pages,   setPages]   = useState<Array<{ url: string; title: string }>>([])
  const abortRef  = useRef<AbortController | null>(null)
  const lineId    = useRef(0)
  const bottomRef = useRef<HTMLDivElement>(null)

  const addLine = useCallback((line: Omit<DiscoveryLine, 'id'>) => {
    setLines(prev => [...prev, { ...line, id: lineId.current++ }])
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  useEffect(() => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLines([])
    setStatus('running')
    setCount(0)
    setPages([])
    lineId.current = 0

    ;(async () => {
      try {
        const res = await fetch(`/api/auto-discover?q=${encodeURIComponent(query)}`, {
          signal: ctrl.signal, cache: 'no-store',
        })
        if (!res.body) return
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const parts = buf.split('\n\n')
          buf = parts.pop() ?? ''
          for (const part of parts) {
            const dl = part.split('\n').find(l => l.startsWith('data: '))
            if (!dl) continue
            try {
              const ev = JSON.parse(dl.slice(6))
              addLine({ type: ev.type, msg: ev.msg, url: ev.url, title: ev.title })
              if (ev.done) {
                if (ev.type === 'done')  { setStatus('found'); setCount(ev.found ?? 0); setPages(ev.pages ?? []) }
                if (ev.type === 'none')  setStatus('none')
                if (ev.type === 'info')  setStatus('broad')
              }
            } catch { /* skip */ }
          }
        }
      } catch (e: unknown) {
        if ((e as Error)?.name !== 'AbortError') setStatus('none')
      }
    })()

    return () => ctrl.abort()
  }, [query, addLine])

  // Auto-refresh search after finding pages
  useEffect(() => {
    if (status === 'found' && count > 0) {
      const t = setTimeout(onRefresh, 800)
      return () => clearTimeout(t)
    }
  }, [status, count, onRefresh])

  const lineStyle: Record<string, string> = {
    system: 'text-[#6272a4]', info: 'text-[#9ec6f3]', ok: 'text-[#5af78e]',
    wait: 'text-[#abb2bf] italic', skip: 'text-[#6272a4]', done: 'text-[#5af78e] font-semibold',
    none: 'text-[#f4f99d]', warn: 'text-[#f4f99d]',
  }

  return (
    <div className="max-w-2xl space-y-4 py-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-blue/10 border border-blue/20 flex items-center justify-center flex-shrink-0">
          {status === 'running' ? (
            <span className="flex gap-0.5">
              {[0,1,2].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-blue animate-pulse" style={{ animationDelay: `${i*0.2}s` }} />)}
            </span>
          ) : status === 'found' ? (
            <svg className="w-4 h-4 text-green" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
          ) : (
            <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          )}
        </div>
        <div>
          <p className="text-content text-sm font-semibold">
            {status === 'running' && <>Searching the web for &ldquo;{query}&rdquo;…</>}
            {status === 'found'   && <>{count} page{count !== 1 ? 's' : ''} discovered — loading results…</>}
            {status === 'none'    && <>No public pages found for &ldquo;{query}&rdquo;</>}
            {status === 'broad'   && <>Query too broad for auto-discovery</>}
          </p>
          <p className="text-muted text-xs mt-0.5">
            {status === 'running' && 'Scanning GitHub, GitLab, 20 TLDs, npm, PyPI, dev.to, Medium, Vercel, Netlify…'}
            {status === 'found'   && 'Pages indexed and added to search results'}
            {status === 'none'    && 'The site may require login or JavaScript to render'}
            {status === 'broad'   && 'Try a name or username instead'}
          </p>
        </div>
      </div>

      {/* Live log */}
      <div className="bg-[#1a1b2e] rounded-xl border border-white/10 overflow-hidden">
        <div className="bg-[#1e1e2e] border-b border-white/10 px-3 py-1.5 flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]"/>
          <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]"/>
          <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]"/>
          <span className="text-[11px] text-[#6272a4] font-mono ml-2">angkorsearch — web discovery</span>
        </div>
        <div className="p-3 font-mono text-[12px] leading-5 max-h-48 overflow-y-auto space-y-0.5">
          {lines.filter(line => line.type !== 'wait').map(line => (
            <div key={line.id} className={`flex gap-2 ${lineStyle[line.type] ?? 'text-[#abb2bf]'}`}>
              <span className="flex-shrink-0 select-none w-4">
                {line.type === 'ok' ? '✓' : line.type === 'skip' ? '✗' : line.type === 'done' ? '✓' : ' '}
              </span>
              <span className="truncate">
                {line.url
                  ? <><span className="opacity-60">{new URL(line.url).hostname}</span>{' '}<span>{line.msg}</span></>
                  : line.msg}
              </span>
            </div>
          ))}
          {/* Show live scanning count instead of spammy wait lines */}
          {(() => {
            const waiting = lines.filter(l => l.type === 'wait').length
            const done    = lines.filter(l => l.type === 'ok' || l.type === 'skip').length
            const total   = lines.length - lines.filter(l => ['system','info','done','none'].includes(l.type)).length
            if (waiting === 0 || total === 0) return null
            return (
              <div className="text-[#6272a4] italic mt-0.5">
                … scanning {waiting} more ({done}/{total} checked)
              </div>
            )
          })()}
          {status === 'running' && (
            <div className="flex gap-2 mt-1">
              <span className="w-4 text-[#6272a4]"> </span>
              <span className="text-[#9ec6f3] animate-pulse">█</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Found pages list */}
      {pages.length > 0 && (
        <div className="space-y-2">
          {pages.map(p => (
            <a key={p.url} href={p.url} target="_blank" rel="noreferrer"
              className="flex items-center gap-3 p-3 bg-card border border-border rounded-xl hover:border-blue/40 transition-all group">
              <div className="w-6 h-6 rounded-full bg-green/10 flex items-center justify-center flex-shrink-0">
                <svg className="w-3 h-3 text-green" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
              </div>
              <div className="min-w-0">
                <p className="text-content text-sm font-medium group-hover:text-blue transition-colors truncate">{p.title}</p>
                <p className="text-green text-xs truncate">{p.url}</p>
              </div>
            </a>
          ))}
        </div>
      )}

      {/* Tips when nothing found */}
      {(status === 'none' || status === 'broad') && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-2.5 text-sm text-muted">
          <p className="flex items-start gap-2">
            <span className="text-blue mt-0.5 flex-shrink-0">💡</span>
            <span>Try searching a <strong className="text-content">username</strong> or <strong className="text-content">domain name</strong> (e.g. <em>muyleanging</em>, <em>khmerstack</em>)</span>
          </p>
          <p className="flex items-start gap-2">
            <span className="text-green mt-0.5 flex-shrink-0">⚡</span>
            <span>Use <a href="/crawl" className="text-blue hover:underline font-medium">Force Crawl</a> to index any specific URL instantly</span>
          </p>
          <p className="flex items-start gap-2">
            <span className="text-yellow mt-0.5 flex-shrink-0">⚠</span>
            <span>Facebook, Instagram, TikTok require login — their content cannot be indexed by any search engine</span>
          </p>
        </div>
      )}

      {/* Manual retry */}
      <button
        onClick={onRefresh}
        className="text-xs text-muted hover:text-content border border-border px-4 py-2 rounded-full hover:border-blue/40 transition-all"
      >
        Refresh search results
      </button>
    </div>
  )
}

// ── Related Profile Links — shown when results are sparse ─────────────────────
function buildProfileLinks(query: string) {
  const words = query.trim().toLowerCase()
    .split(/\s+/)
    .filter(w => /^[a-z0-9-]+$/.test(w) && w.length >= 2)
  if (words.length === 0 || words.length > 3) return []

  const skip = ['news','video','image','search','what','how','why','when',
                'where','the','and','for','cambodia','khmer','latest','best','top']
  if (words.some(w => skip.includes(w))) return []

  const slug     = words.join('')
  const slugDash = words.join('-')
  const handle   = slugDash !== slug ? slugDash : slug

  return [
    { label: 'GitHub',   url: `https://github.com/${handle}`,             color: '#6272a4', crawlable: true  },
    { label: 'Website',  url: `https://${handle}.me`,                     color: '#5af78e', crawlable: true  },
    { label: 'Website',  url: `https://${handle}.com`,                    color: '#5af78e', crawlable: true  },
    { label: 'YouTube',  url: `https://www.youtube.com/@${slug}`,         color: '#ff5555', crawlable: false },
    { label: 'LinkedIn', url: `https://linkedin.com/in/${handle}`,        color: '#9ec6f3', crawlable: true  },
    { label: 'Facebook', url: `https://facebook.com/${slug}`,             color: '#6272a4', crawlable: false },
  ]
}

function RelatedProfiles({ query }: { query: string }) {
  const links = buildProfileLinks(query)
  if (links.length === 0) return null
  return (
    <div className="mb-6 p-4 bg-card border border-border rounded-xl">
      <p className="text-xs text-muted mb-3 font-medium uppercase tracking-wide">Related profiles for &ldquo;{query}&rdquo;</p>
      <div className="flex flex-wrap gap-2">
        {links.map(link => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-border hover:border-blue/40 hover:bg-blue/5 transition-all text-content"
          >
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: link.color }} />
            <span className="font-medium">{link.label}</span>
            <span className="text-muted truncate max-w-[120px]">{new URL(link.url).hostname.replace('www.','')}</span>
            {!link.crawlable && (
              <span className="text-[10px] text-yellow opacity-70">login req.</span>
            )}
          </a>
        ))}
      </div>
      <p className="text-[11px] text-muted mt-2">These are external links — click to visit. Use Force Crawl to index any page.</p>
    </div>
  )
}

// ── Infinite-scroll media section ─────────────────────────────────────────────
function MediaGrid({
  query, tab, lang,
}: { query: string; tab: 'image' | 'video'; lang: string }) {
  const [items, setItems]       = useState<SearchResult[]>([])
  const [pg, setPg]             = useState(1)
  const [hasMore, setHasMore]   = useState(true)
  const [loading, setLoading]   = useState(false)
  const [cat, setCat]           = useState('')
  const sentinelRef             = useRef<HTMLDivElement>(null)

  // Keep latest values in a ref to avoid stale closures in IntersectionObserver
  const stateRef = useRef({ query, tab, lang, pg, hasMore, loading })
  stateRef.current = { query, tab, lang, pg, hasMore, loading }

  const doFetch = useCallback(async (page: number, reset: boolean) => {
    const { query: q, tab: t, lang: l } = stateRef.current
    if (!q) return
    setLoading(true)
    try {
      const data = await fetchSearch(q, t, page, l)
      const batch = data.results ?? []
      if (reset) setItems(batch)
      else setItems(prev => [...prev, ...batch])
      setHasMore(batch.length >= 10)
      setPg(page)
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  // Reset + fetch page 1 when query/tab/lang changes
  useEffect(() => {
    if (!query) return
    setCat('')
    setItems([])
    setPg(1)
    setHasMore(true)
    doFetch(1, true)
  }, [query, tab, lang, doFetch])

  // IntersectionObserver sentinel
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return
      const { pg: curPg, hasMore: more, loading: busy } = stateRef.current
      if (more && !busy) doFetch(curPg + 1, false)
    }, { threshold: 0.3 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [doFetch])

  // Derive category list (unique domains) from loaded items
  const categories = useMemo(() => {
    const seen = new Set<string>()
    items.forEach(r => {
      const d = r.domain ?? (() => { try { return new URL(r.url).hostname } catch { return '' } })()
      if (d) seen.add(d)
    })
    return Array.from(seen)
  }, [items])

  const filtered = cat ? items.filter(r => {
    const d = r.domain ?? (() => { try { return new URL(r.url).hostname } catch { return '' } })()
    return d === cat
  }) : items

  return (
    <div>
      {/* Category filter pills */}
      {categories.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setCat('')}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              cat === '' ? 'bg-blue text-white border-blue' : 'border-border text-muted hover:border-blue/50 hover:text-content'
            }`}
          >
            All
          </button>
          {categories.map(d => (
            <button
              key={d}
              onClick={() => setCat(d)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                cat === d ? 'bg-blue text-white border-blue' : 'border-border text-muted hover:border-blue/50 hover:text-content'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      )}

      {/* Loading skeleton (first load) */}
      {loading && items.length === 0 && <Skeleton />}

      {/* Image grid */}
      {tab === 'image' && (
        <div className="columns-2 sm:columns-3 gap-3">
          {filtered.map((r, i) => <ImageResult key={r.url + i} result={r} index={i} />)}
        </div>
      )}

      {/* Video grid */}
      {tab === 'video' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filtered.map((r, i) => <VideoResult key={r.id ?? i} result={r} index={i} />)}
        </div>
      )}

      {/* Sentinel + load-more spinner */}
      <div ref={sentinelRef} className="h-8 mt-4 flex items-center justify-center">
        {loading && items.length > 0 && (
          <div className="flex gap-1.5">
            {[0, 1, 2].map(i => (
              <div key={i} className="w-2 h-2 rounded-full bg-blue animate-pulse" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        )}
        {!hasMore && filtered.length > 0 && (
          <p className="text-muted text-xs">All {filtered.length} results loaded</p>
        )}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function SearchResults({ query, tab, page, lang, onResults }: Props) {
  const router = useRouter()
  const { results, loading, error, aiAnswer, aiModel, aiLoading, search } = useSearch()
  const { bookmarks, history, loadBookmarks, loadHistory, deleteHistory } = useBookmark()

  useEffect(() => {
    if (!query) return
    if (tab === 'bookmarks') { loadBookmarks(); return }
    if (tab === 'history')   { loadHistory();   return }
    // image/video use their own MediaGrid state — skip useSearch for them
    if (tab === 'image' || tab === 'video') return
    search(query, tab, page, lang)
  }, [query, tab, page, lang])

  useEffect(() => {
    if (!loading && results.length > 0) onResults?.(results)
  }, [results, loading])

  function goPage(p: number) {
    router.push(`/search?q=${encodeURIComponent(query)}&tab=${tab}&page=${p}&lang=${lang}`)
  }

  // ── Bookmarks ──
  if (tab === 'bookmarks') {
    return (
      <div>
        <h2 className="text-content font-semibold mb-4">Saved Bookmarks</h2>
        {bookmarks.length === 0
          ? <p className="text-muted text-sm">No bookmarks yet. Click 🔖 on any result.</p>
          : bookmarks.map((b, i) => (
            <div key={i} className="py-3 border-b border-border">
              <a href={b.url} target="_blank" rel="noreferrer" className="text-blue hover:underline text-base font-khmer">{b.title || b.url}</a>
              <p className="text-green text-xs mt-0.5 truncate">{b.url}</p>
            </div>
          ))
        }
      </div>
    )
  }

  // ── History ──
  if (tab === 'history') {
    return (
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-content font-semibold">Search History</h2>
          {history.length > 0 && (
            <button onClick={deleteHistory} className="text-xs text-red border border-red/30 px-3 py-1.5 rounded-full hover:bg-red/10 transition-colors">
              Clear all
            </button>
          )}
        </div>
        {history.length === 0
          ? <p className="text-muted text-sm">No history yet.</p>
          : history.map((h, i) => (
            <div
              key={i}
              className="flex justify-between items-center py-3 border-b border-border cursor-pointer hover:bg-card2 px-2 rounded transition-colors"
              onClick={() => router.push(`/search?q=${encodeURIComponent(h.query)}&tab=${h.type === 'web' ? 'all' : h.type}`)}
            >
              <div className="flex items-center gap-2 text-sm text-content font-khmer">
                <span className="text-muted">🔍</span> {h.query}
              </div>
              <span className="text-xs text-muted whitespace-nowrap">{h.results} results</span>
            </div>
          ))
        }
      </div>
    )
  }

  // ── Image / Video (self-managed infinite scroll) ──
  if (tab === 'image' || tab === 'video') {
    return <MediaGrid query={query} tab={tab} lang={lang} />
  }

  // ── Loading ──
  if (loading) return <Skeleton />

  // ── Error ──
  if (error) return (
    <div className="py-10 text-center">
      <p className="text-red text-sm">{error}</p>
    </div>
  )

  // ── No results → auto web discovery ──
  if (!results.length) return (
    <WebDiscovery query={query} onRefresh={() => search(query, tab, page, lang)} />
  )

  // ── All / Web ──
  if (tab === 'all') {
    return (
      <div>
        <AIOverview answer={aiAnswer} model={aiModel} loading={aiLoading} />
        <p className="text-muted text-xs mb-4">About {results.length.toLocaleString()} results</p>
        {results.length < 4 && <RelatedProfiles query={query} />}
        <TopResult result={results[0]} query={query} />
        {results.slice(1).map((r, i) => (
          <div key={r.id ?? i}>
            <WebResult result={r} query={query} index={i} />
            {i === 1 && <PeopleAlsoAsk query={query} />}
          </div>
        ))}
        <Pagination page={page} hasMore={results.length === 10} onPage={goPage} />
      </div>
    )
  }

  // ── News ──
  if (tab === 'news') {
    return (
      <div>
        <p className="text-muted text-xs mb-4">{results.length.toLocaleString()} news articles</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {results.map((r, i) => <NewsResult key={r.id ?? i} result={r} index={i} />)}
        </div>
        <Pagination page={page} hasMore={results.length === 10} onPage={goPage} />
      </div>
    )
  }

  // ── Dev & Tech ──
  if (tab === 'github') {
    return (
      <div className="space-y-3">
        <p className="text-muted text-xs mb-4">{results.length.toLocaleString()} dev & tech resources</p>
        {results.map((r, i) => <GithubResult key={r.id ?? i} result={r} index={i} />)}
        <Pagination page={page} hasMore={results.length === 10} onPage={goPage} />
      </div>
    )
  }

  return null
}
