'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { fetchSearch, saveBookmark } from '@/lib/api'
import { timeSince, getDomain, truncate } from '@/lib/utils'
import { useAuth } from '@/lib/AuthContext'
import type { SearchResult } from '@/types'

const LANG_COLORS: Record<string, string> = {
  JavaScript:'#f1e05a', TypeScript:'#3178c6', Python:'#3572A5',
  Go:'#00ADD8', Rust:'#dea584', Java:'#b07219', 'C++':'#f34b7d',
  Kotlin:'#A97BFF', HTML:'#e34c26', PHP:'#4F5D95', Shell:'#89e051',
}

type FeedTab = 'foryou' | 'github' | 'news' | 'tech' | 'trending'
type TimeFilter = 'today' | 'week' | 'month' | 'all'

const TABS: {id:FeedTab; label:string; query:{q:string;type:string}}[] = [
  { id:'foryou',   label:'For You',  query:{ q:'cambodia developer tech',    type:'web'    }},
  { id:'github',   label:'GitHub',   query:{ q:'cambodia khmer open source', type:'github' }},
  { id:'news',     label:'News',     query:{ q:'cambodia technology news',   type:'news'   }},
  { id:'tech',     label:'Dev Blog', query:{ q:'cambodia software engineer', type:'web'    }},
  { id:'trending', label:'Trending', query:{ q:'cambodia trending viral',    type:'web'    }},
]

const TAGS = [
  'Cambodia','Khmer','JavaScript','TypeScript','Go','Python','React',
  'NextJS','Docker','PostgreSQL','AI','OpenSource','KhmerDev',
]

export default function FeedPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [tab,          setTab]          = useState<FeedTab>('foryou')
  const [time,         setTime]         = useState<TimeFilter>('week')
  const [cambodiaOnly, setCambodiaOnly] = useState(false)
  const [items,        setItems]        = useState<SearchResult[]>([])
  const [loading,      setLoading]      = useState(true)
  const [page,         setPage]         = useState(1)
  const [toast,        setToast]        = useState<string|null>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  const load = useCallback(async (reset = false) => {
    setLoading(true)
    try {
      const t = TABS.find(t => t.id === tab)!
      const q = cambodiaOnly ? `cambodia ${t.query.q}` : t.query.q
      const res = await fetchSearch(q, t.query.type, reset ? 1 : page)
      setItems(prev => reset ? res.results : [...prev, ...res.results])
      if (reset) setPage(1)
    } catch {}
    finally { setLoading(false) }
  }, [tab, page, cambodiaOnly])

  useEffect(() => { load(true) }, [tab, time, cambodiaOnly]) // eslint-disable-line

  async function handleBookmark(url: string, title: string) {
    await saveBookmark(url, title)
    showToast('Saved to bookmarks!')
  }

  return (
    <div className="min-h-screen bg-primary">
      {/* ── Top nav ── */}
      <header className="sticky top-0 z-40 bg-card/80 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-4">
          <Link href="/" className="flex-shrink-0">
            <img src="/logo.png" alt="AngkorSearch" className="h-8 w-auto" />
          </Link>

          {/* Tabs */}
          <div className="flex items-center gap-0.5 overflow-x-auto hide-scrollbar flex-1">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                  tab === t.id ? 'bg-blue/10 text-blue' : 'text-muted hover:text-content hover:bg-hover'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Cambodia Only */}
            <button onClick={() => setCambodiaOnly(v => !v)}
              className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                cambodiaOnly ? 'bg-blue/10 text-blue border-blue/30' : 'text-muted border-border hover:text-content'
              }`}>
              🇰🇭 Cambodia
            </button>
            {user ? (
              <Link href="/profile?tab=bookmarks"
                className="hidden sm:flex items-center gap-1.5 text-xs text-muted hover:text-content px-3 py-1.5 rounded-full hover:bg-hover transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z"/>
                </svg>
                Saved
              </Link>
            ) : (
              <Link href="/login" className="text-xs font-medium text-white bg-blue hover:bg-blue/90 px-3 py-1.5 rounded-full transition-colors">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 flex gap-6">
        {/* ── Main feed ── */}
        <div className="flex-1 min-w-0">
          {/* Filter bar */}
          <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
            <div>
              <h1 className="text-base font-bold text-content">
                {TABS.find(t => t.id === tab)?.label}
                {cambodiaOnly && <span className="ml-2 text-xs font-normal text-blue">🇰🇭 Cambodia only</span>}
              </h1>
            </div>
            <div className="flex items-center gap-1 bg-card border border-border rounded-xl p-1">
              {(['today','week','month','all'] as TimeFilter[]).map(f => (
                <button key={f} onClick={() => setTime(f)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors capitalize ${
                    time===f ? 'bg-blue text-white' : 'text-muted hover:text-content'
                  }`}>
                  {f==='today'?'Today':f==='week'?'Week':f==='month'?'Month':'All'}
                </button>
              ))}
            </div>
          </div>

          {/* Grid */}
          {loading && items.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {[...Array(9)].map((_,i) => <SkeletonCard key={i} />)}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-20 text-muted">
              <p className="text-3xl mb-3">◈</p>
              <p>No results found.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {items.map((item, i) => (
                  <FeedCard key={item.url+i} item={item} onBookmark={handleBookmark} />
                ))}
              </div>
              <div className="flex justify-center mt-8">
                <button onClick={() => { setPage(p=>p+1); load() }} disabled={loading}
                  className="px-6 py-2.5 bg-card border border-border text-muted text-sm rounded-xl hover:text-content hover:border-blue/40 transition-colors disabled:opacity-50">
                  {loading ? 'Loading…' : 'Load more'}
                </button>
              </div>
            </>
          )}
        </div>

        {/* ── Right sidebar ── */}
        <aside className="hidden xl:flex flex-col w-64 flex-shrink-0 gap-5">
          {/* Tags */}
          <div className="bg-card border border-border rounded-2xl p-4">
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {TAGS.map(tag => (
                <button key={tag}
                  onClick={() => router.push(`/search?q=${encodeURIComponent(tag)}&tab=all`)}
                  className="text-xs px-2.5 py-1 bg-card2 border border-border text-muted rounded-full hover:border-blue/40 hover:text-content transition-colors">
                  #{tag}
                </button>
              ))}
            </div>
          </div>

          {/* Quick links */}
          <div className="bg-card border border-border rounded-2xl p-4">
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Quick Links</p>
            <div className="flex flex-col gap-1">
              {[
                { label:'Search',    href:'/',            icon:'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
                { label:'Bookmarks', href:'/profile?tab=bookmarks', icon:'M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z' },
                { label:'Settings',  href:'/profile?tab=settings',  icon:'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
              ].map(l => (
                <Link key={l.href} href={l.href}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-muted hover:text-content hover:bg-hover rounded-xl transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={l.icon}/>
                  </svg>
                  {l.label}
                </Link>
              ))}
            </div>
          </div>

          {/* About */}
          <div className="bg-card border border-border rounded-2xl p-4">
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">About</p>
            <p className="text-xs text-muted leading-relaxed">
              Cambodia&apos;s open dev &amp; tech feed. Powered by AngkorSearch.
            </p>
            <Link href="/about" className="text-xs text-blue hover:underline mt-2 inline-block">Learn more →</Link>
          </div>
        </aside>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-blue text-white text-sm px-4 py-2.5 rounded-xl shadow-xl z-50 flex items-center gap-2">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M5 3h14a1 1 0 011 1v17l-7-3-7 3V4a1 1 0 011-1z"/>
          </svg>
          {toast}
        </div>
      )}
    </div>
  )
}

// ─── Feed Card ─────────────────────────────────────────────────────────────────
function FeedCard({ item, onBookmark }: { item: SearchResult; onBookmark:(url:string,title:string)=>void }) {
  const domain   = getDomain(item.url)
  const isGitHub = item.url.includes('github.com')
  const title    = item.full_name || item.name || item.title || domain
  const desc     = item.desc || item.description || item.snippet || ''
  const langClr  = item.lang ? (LANG_COLORS[item.lang] ?? '#8b949e') : null
  const [saved, setSaved] = useState(false)

  async function bookmark(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    await onBookmark(item.url, title)
    setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  return (
    <a href={item.url} target="_blank" rel="noreferrer"
      className="group flex flex-col bg-card border border-border rounded-2xl overflow-hidden hover:border-blue/30 hover:shadow-xl hover:shadow-black/30 transition-all duration-200">

      {/* Thumbnail */}
      {item.image && (
        <div className="h-40 overflow-hidden bg-card2 flex-shrink-0">
          <img src={item.image} alt={title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            onError={e => (e.currentTarget.parentElement!.style.display='none')} />
        </div>
      )}

      <div className="flex flex-col gap-2 p-4 flex-1">
        {/* Source */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <img src={`https://www.google.com/s2/favicons?sz=16&domain=${domain}`} alt=""
              className="w-4 h-4 rounded-sm flex-shrink-0"
              onError={e => (e.currentTarget.style.display='none')} />
            <span className="text-xs text-muted truncate">{domain}</span>
            {isGitHub && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#8b949e]/15 text-[#8b949e] border border-[#8b949e]/30 flex-shrink-0">GitHub</span>}
            {item.lang === 'km' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue/15 text-blue border border-blue/30 flex-shrink-0">🇰🇭</span>}
          </div>
          <button onClick={bookmark} title="Bookmark"
            className="opacity-0 group-hover:opacity-100 p-1 text-muted hover:text-blue transition-all flex-shrink-0">
            {saved ? (
              <svg className="w-4 h-4 text-blue" fill="currentColor" viewBox="0 0 24 24"><path d="M5 3h14a1 1 0 011 1v17l-7-3-7 3V4a1 1 0 011-1z"/></svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
            )}
          </button>
        </div>

        {/* Title */}
        <h3 className="text-content font-semibold text-sm leading-snug line-clamp-2 group-hover:text-blue transition-colors font-khmer">
          {title}
        </h3>

        {/* Desc */}
        {desc && (
          <p className="text-muted text-xs leading-relaxed line-clamp-2 font-khmer">{truncate(desc, 120)}</p>
        )}

        {/* Topics */}
        {item.topics && item.topics.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {item.topics.slice(0, 4).map((t,i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 bg-card2 border border-border text-muted rounded-full">#{t}</span>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between mt-auto pt-2 border-t border-border/50 text-xs text-muted">
          <div className="flex items-center gap-3">
            {langClr && item.lang && isGitHub && (
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{background:langClr}}/>
                {item.lang}
              </span>
            )}
            {isGitHub && (
              <span className="flex items-center gap-1">
                <svg className="w-3 h-3 text-yellow" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.751.751 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25Z"/>
                </svg>
                {Number(item.stars??0).toLocaleString()}
              </span>
            )}
          </div>
          <span>{timeSince(item.published)}</span>
        </div>
      </div>
    </a>
  )
}

function SkeletonCard() {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden animate-pulse">
      <div className="h-40 bg-card2" />
      <div className="p-4 space-y-2">
        <div className="h-3 bg-card2 rounded w-1/3" />
        <div className="h-4 bg-card2 rounded w-full" />
        <div className="h-4 bg-card2 rounded w-4/5" />
        <div className="h-3 bg-card2 rounded w-1/2" />
      </div>
    </div>
  )
}
