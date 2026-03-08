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
  const [status,  setStatus]  = useState<'running' | 'found' | 'none' | 'broad' | 'offline'>('running')
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
        if ((e as Error)?.name === 'AbortError') return
        if (!navigator.onLine || (e as Error)?.name === 'TypeError') {
          setStatus('offline')
        } else {
          setStatus('none')
        }
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
        <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${status === 'offline' ? 'bg-red/10 border border-red/20' : 'bg-blue/10 border border-blue/20'}`}>
          {status === 'running' ? (
            <span className="flex gap-0.5">
              {[0,1,2].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-blue animate-pulse" style={{ animationDelay: `${i*0.2}s` }} />)}
            </span>
          ) : status === 'found' ? (
            <svg className="w-4 h-4 text-green" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
          ) : status === 'offline' ? (
            <svg className="w-4 h-4 text-red" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728M15.536 8.464a5 5 0 010 7.072M3 3l18 18M9.88 9.88A3 3 0 0012 15a3 3 0 002.12-.88"/></svg>
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
            {status === 'offline' && <span className="text-red">No internet connection</span>}
          </p>
          <p className="text-muted text-xs mt-0.5">
            {status === 'running' && 'Scanning GitHub, GitLab, 20 TLDs, npm, PyPI, dev.to, Medium, Vercel, Netlify…'}
            {status === 'found'   && 'Pages indexed and added to search results'}
            {status === 'none'    && 'The site may require login or JavaScript to render'}
            {status === 'broad'   && 'Try a name or username instead'}
            {status === 'offline' && 'Please check your Wi-Fi or mobile data and try again'}
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

      {/* Offline retry */}
      {status === 'offline' && (
        <button
          onClick={() => { setStatus('running'); setLines([]); }}
          className="text-xs text-blue border border-blue/30 px-4 py-1.5 rounded-full hover:bg-blue/10 transition-colors"
        >
          Retry when connected
        </button>
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
    { label: 'GitHub',    url: `https://github.com/${handle}`,             color: '#6272a4', crawlable: true  },
    { label: 'Website',   url: `https://${handle}.me`,                     color: '#5af78e', crawlable: true  },
    { label: 'Website',   url: `https://${handle}.com`,                    color: '#5af78e', crawlable: true  },
    { label: 'YouTube',   url: `https://www.youtube.com/@${slug}`,         color: '#ff5555', crawlable: false },
    { label: 'TikTok',    url: `https://www.tiktok.com/@${slug}`,          color: '#69C9D0', crawlable: false },
    { label: 'LinkedIn',  url: `https://linkedin.com/in/${handle}`,        color: '#9ec6f3', crawlable: true  },
    { label: 'Facebook',  url: `https://facebook.com/${slug}`,             color: '#4267B2', crawlable: false },
    { label: 'Telegram',  url: `https://t.me/${slug}`,                     color: '#2AABEE', crawlable: false },
    { label: 'Instagram', url: `https://instagram.com/${slug}`,            color: '#E1306C', crawlable: false },
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

// ── Video platform helpers ─────────────────────────────────────────────────────
const VIDEO_PLATFORMS = [
  { key: 'youtube',   label: 'YouTube',   match: (u: string) => u.includes('youtube.com') || u.includes('youtu.be') },
  { key: 'tiktok',    label: 'TikTok',    match: (u: string) => u.includes('tiktok.com') },
  { key: 'facebook',  label: 'Facebook',  match: (u: string) => u.includes('facebook.com') || u.includes('fb.com') },
  { key: 'twitter',   label: 'Twitter/X', match: (u: string) => u.includes('twitter.com') || u.includes('x.com') },
  { key: 'vimeo',     label: 'Vimeo',     match: (u: string) => u.includes('vimeo.com') },
  { key: 'instagram', label: 'Instagram', match: (u: string) => u.includes('instagram.com') },
]

function getPlatformKey(url: string) {
  for (const p of VIDEO_PLATFORMS) if (p.match(url)) return p.key
  return 'other'
}

// ── Image detail side panel ────────────────────────────────────────────────────
function ImagePanel({ item, items, idx, onNav, onClose }: {
  item: SearchResult; items: SearchResult[]; idx: number
  onNav: (i: number) => void; onClose: () => void
}) {
  const domain = item.domain ?? (() => { try { return new URL(item.page_url || item.url).hostname } catch { return '' } })()

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape')      onClose()
      if (e.key === 'ArrowRight' && idx < items.length - 1) onNav(idx + 1)
      if (e.key === 'ArrowLeft'  && idx > 0)                onNav(idx - 1)
    }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [idx, items.length, onNav, onClose])

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full z-50 w-full sm:w-[420px] bg-card border-l border-border flex flex-col shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <span className="text-xs text-muted">{idx + 1} / {items.length}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => idx > 0 && onNav(idx - 1)}
              disabled={idx === 0}
              className="p-1.5 rounded-lg hover:bg-card2 disabled:opacity-30 text-muted hover:text-content transition-colors">
              ←
            </button>
            <button onClick={() => idx < items.length - 1 && onNav(idx + 1)}
              disabled={idx === items.length - 1}
              className="p-1.5 rounded-lg hover:bg-card2 disabled:opacity-30 text-muted hover:text-content transition-colors">
              →
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-card2 text-muted hover:text-content transition-colors">
              ✕
            </button>
          </div>
        </div>

        {/* Image */}
        <div className="bg-black/40 flex items-center justify-center min-h-[240px] flex-shrink-0">
          <img
            src={item.url}
            alt={item.alt || item.title || ''}
            className="max-w-full max-h-[60vh] object-contain"
          />
        </div>

        {/* Details */}
        <div className="p-4 space-y-4 flex-1">
          {(item.alt || item.title) && (
            <p className="text-content text-sm font-medium leading-relaxed">{item.alt || item.title}</p>
          )}

          <div className="space-y-2 text-xs text-muted">
            <div className="flex items-start gap-2">
              <span className="text-blue flex-shrink-0 w-16">Domain</span>
              <span className="text-content">{domain}</span>
            </div>
            {item.page_url && (
              <div className="flex items-start gap-2">
                <span className="text-blue flex-shrink-0 w-16">Source</span>
                <a href={item.page_url} target="_blank" rel="noreferrer"
                  className="text-blue hover:underline truncate">{item.page_url}</a>
              </div>
            )}
            {item.type && (
              <div className="flex items-start gap-2">
                <span className="text-blue flex-shrink-0 w-16">Type</span>
                <span className="text-content uppercase">{item.type}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="grid grid-cols-2 gap-2 pt-2">
            <a href={item.url} target="_blank" rel="noreferrer"
              className="flex items-center justify-center gap-1.5 text-xs py-2 px-3 rounded-lg bg-blue text-white hover:bg-blue/80 transition-colors font-medium">
              🖼 Full size
            </a>
            <a href={item.page_url || item.url} target="_blank" rel="noreferrer"
              className="flex items-center justify-center gap-1.5 text-xs py-2 px-3 rounded-lg border border-border text-content hover:border-blue/40 transition-colors">
              🔗 Source page
            </a>
            <button
              onClick={() => navigator.clipboard.writeText(item.url)}
              className="flex items-center justify-center gap-1.5 text-xs py-2 px-3 rounded-lg border border-border text-content hover:border-blue/40 transition-colors col-span-2">
              📋 Copy image URL
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Infinite-scroll media section ─────────────────────────────────────────────
function MediaGrid({
  query, tab, lang,
}: { query: string; tab: 'image' | 'video'; lang: string }) {
  const [items, setItems]           = useState<SearchResult[]>([])
  const [pg, setPg]                 = useState(1)
  const [hasMore, setHasMore]       = useState(true)
  const [loading, setLoading]       = useState(false)
  const [platFilter, setPlatFilter] = useState('')
  const [panelIdx, setPanelIdx]     = useState(-1)
  const sentinelRef                 = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    if (!query) return
    setPlatFilter('')
    setPanelIdx(-1)
    setItems([])
    setPg(1)
    setHasMore(true)
    doFetch(1, true)
  }, [query, tab, lang, doFetch])

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

  // For video: derive which platforms are present in results
  const presentPlatforms = useMemo(() => {
    if (tab !== 'video') return []
    const seen = new Set<string>()
    items.forEach(r => seen.add(getPlatformKey(r.url)))
    return VIDEO_PLATFORMS.filter(p => seen.has(p.key))
  }, [items, tab])

  const filtered = useMemo(() => {
    if (!platFilter) return items
    return items.filter(r => getPlatformKey(r.url) === platFilter)
  }, [items, platFilter])

  const panelItem = panelIdx >= 0 ? filtered[panelIdx] ?? null : null

  return (
    <div>
      {/* ── Video platform filter pills ── */}
      {tab === 'video' && presentPlatforms.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button onClick={() => setPlatFilter('')}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              platFilter === '' ? 'bg-blue text-white border-blue' : 'border-border text-muted hover:border-blue/50 hover:text-content'
            }`}>All</button>
          {presentPlatforms.map(p => (
            <button key={p.key} onClick={() => setPlatFilter(p.key)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                platFilter === p.key ? 'bg-blue text-white border-blue' : 'border-border text-muted hover:border-blue/50 hover:text-content'
              }`}>{p.label}</button>
          ))}
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && items.length === 0 && <Skeleton />}

      {/* ── Empty state ── */}
      {!loading && items.length === 0 && (
        <div className="py-8 space-y-4 max-w-lg">
          <p className="text-content font-semibold text-sm">
            No {tab === 'image' ? 'images' : 'videos'} indexed yet for &ldquo;{query}&rdquo;
          </p>
          <p className="text-muted text-sm">
            The crawler hasn&apos;t visited those pages yet. Force-crawl specific URLs to index photos.
          </p>
          <div className="space-y-2">
            {[`https://github.com/${query.replace(/\s+/g,'')}`,`https://linkedin.com/in/${query.replace(/\s+/g,'-')}`].map(url => (
              <a key={url} href={`/crawl?url=${encodeURIComponent(url)}`}
                className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-border hover:border-blue/40 text-muted hover:text-content transition-all">
                <span className="text-blue">⚡</span><span className="truncate">Force crawl {url}</span>
              </a>
            ))}
            <a href="/crawl" className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-border hover:border-blue/40 text-muted hover:text-content transition-all">
              <span className="text-green">+</span><span>Crawl a custom URL</span>
            </a>
          </div>
          <p className="text-[11px] text-muted">Facebook, Instagram, TikTok profiles require login — cannot be crawled.</p>
        </div>
      )}

      {/* ── Image masonry grid (full width, 4-6 cols) ── */}
      {tab === 'image' && filtered.length > 0 && (
        <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6 gap-2">
          {filtered.map((r, i) => (
            <ImageResult key={r.url + i} result={r} index={i} onSelect={() => setPanelIdx(i)} />
          ))}
        </div>
      )}

      {/* ── Video grid (3-4 cols) ── */}
      {tab === 'video' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((r, i) => <VideoResult key={r.id ?? i} result={r} index={i} />)}
        </div>
      )}

      {/* ── Load-more sentinel ── */}
      <div ref={sentinelRef} className="h-10 mt-4 flex items-center justify-center">
        {loading && items.length > 0 && (
          <div className="flex gap-1.5">
            {[0,1,2].map(i => <div key={i} className="w-2 h-2 rounded-full bg-blue animate-pulse" style={{ animationDelay: `${i*0.15}s` }} />)}
          </div>
        )}
        {!hasMore && filtered.length > 0 && (
          <p className="text-muted text-xs">{filtered.length} results loaded</p>
        )}
      </div>

      {/* ── Image detail side panel ── */}
      {panelItem && (
        <ImagePanel
          item={panelItem}
          items={filtered}
          idx={panelIdx}
          onNav={i => setPanelIdx(i)}
          onClose={() => setPanelIdx(-1)}
        />
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function SearchResults({ query, tab, page, lang, onResults }: Props) {
  const router = useRouter()
  const { results, loading, retrying, error, aiAnswer, aiModel, aiLoading, search } = useSearch()
  const { bookmarks, history, loadBookmarks, loadHistory, deleteHistory } = useBookmark()
  const [aiEnabled, setAiEnabled] = useState(false)

  useEffect(() => {
    if (!query) return
    if (tab === 'bookmarks') { loadBookmarks(); return }
    if (tab === 'history')   { loadHistory();   return }
    // image/video use their own MediaGrid state — skip useSearch for them
    if (tab === 'image' || tab === 'video') return
    // AI tab searches as 'web' type — shows crawled pages from AI tool domains
    search(query, tab === 'ai' ? 'all' : tab, page, lang, aiEnabled)
  }, [query, tab, page, lang, aiEnabled])

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
  if (loading) return (
    <div>
      <Skeleton />
      {retrying && (
        <p className="text-muted text-xs text-center mt-4 animate-pulse">
          Taking longer than usual, please wait…
        </p>
      )}
    </div>
  )

  // ── Error ──
  if (error) return (
    <div className="py-10 text-center space-y-3">
      <p className="text-red text-sm">{error}</p>
      <button
        onClick={() => search(query, tab === 'ai' ? 'all' : tab as TabId, page, lang, aiEnabled)}
        className="text-xs text-blue border border-blue/30 px-4 py-1.5 rounded-full hover:bg-blue/10 transition-colors"
      >
        Try again
      </button>
    </div>
  )

  // ── No results → auto web discovery ──
  if (!results.length) return (
    <WebDiscovery query={query} onRefresh={() => search(query, tab, page, lang, aiEnabled)} />
  )

  // ── All / Web ──
  if (tab === 'all') {
    return (
      <div>
        {/* AI toggle */}
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => setAiEnabled(e => !e)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${aiEnabled ? 'bg-blue' : 'bg-border'}`}
            aria-pressed={aiEnabled}
            title={aiEnabled ? 'Disable AI Overview' : 'Enable AI Overview'}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform ${aiEnabled ? 'translate-x-4' : 'translate-x-0'}`}
            />
          </button>
          <span className="text-xs text-muted">AI Overview {aiEnabled ? <span className="text-blue">On</span> : <span>Off</span>}</span>
        </div>
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

  // ── AI Tools ──
  if (tab === 'ai') {
    const AI_DOMAINS = [
      { domain: 'claude.ai',        label: 'Claude',     color: '#D97757', icon: '🤖' },
      { domain: 'chat.openai.com',  label: 'ChatGPT',    color: '#10a37f', icon: '🧠' },
      { domain: 'perplexity.ai',    label: 'Perplexity', color: '#9ec6f3', icon: '🔎' },
      { domain: 'gemini.google.com',label: 'Gemini',     color: '#4285f4', icon: '✨' },
      { domain: 'huggingface.co',   label: 'HuggingFace',color: '#FFD21E', icon: '🤗' },
      { domain: 'ollama.com',       label: 'Ollama',     color: '#5af78e', icon: '🦙' },
      { domain: 'arxiv.org',        label: 'arXiv',      color: '#abb2bf', icon: '📄' },
      { domain: 'quantumai.google', label: 'Quantum AI', color: '#4285f4', icon: '⚛️' },
      { domain: 'discord.com',      label: 'Discord',    color: '#5865F2', icon: '💬' },
    ]
    return (
      <div>
        <p className="text-muted text-xs mb-5">Popular AI tools &amp; tech platforms</p>
        {/* Quick links grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
          {AI_DOMAINS.map(ai => (
            <a key={ai.domain} href={`https://${ai.domain}`} target="_blank" rel="noreferrer"
              className="flex items-center gap-3 p-3 bg-card border border-border rounded-xl hover:border-blue/40 transition-all group">
              <span className="text-2xl">{ai.icon}</span>
              <div>
                <p className="text-content text-sm font-semibold group-hover:text-blue transition-colors">{ai.label}</p>
                <p className="text-xs" style={{ color: ai.color }}>{ai.domain}</p>
              </div>
            </a>
          ))}
        </div>
        {/* Crawled results for the AI query */}
        {results.length > 0 && (
          <div>
            <p className="text-muted text-xs mb-3">{results.length} indexed results</p>
            {results.map((r, i) => <WebResult key={r.id ?? i} result={r} query={query} index={i} />)}
            <Pagination page={page} hasMore={results.length === 10} onPage={goPage} />
          </div>
        )}
        {results.length === 0 && !loading && (
          <p className="text-muted text-sm">No indexed results yet — the crawler is discovering these sites.</p>
        )}
      </div>
    )
  }

  return null
}
