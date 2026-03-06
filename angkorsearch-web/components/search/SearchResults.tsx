'use client'
import { useEffect } from 'react'
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
import type { TabId } from '@/types'

import type { SearchResult } from '@/types'

interface Props {
  query:      string
  tab:        TabId
  page:       number
  lang:       string
  onResults?: (results: SearchResult[]) => void
}

export default function SearchResults({ query, tab, page, lang, onResults }: Props) {
  const router = useRouter()
  const { results, loading, error, aiAnswer, aiModel, aiLoading, search } = useSearch()
  const { save, bookmarks, history, loadBookmarks, loadHistory, deleteHistory } = useBookmark()

  useEffect(() => {
    if (!query) return
    if (tab === 'bookmarks') { loadBookmarks(); return }
    if (tab === 'history')   { loadHistory();   return }
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

  // ── Loading ──
  if (loading) return <Skeleton />

  // ── Error ──
  if (error) return (
    <div className="py-10 text-center">
      <p className="text-red text-sm">{error}</p>
    </div>
  )

  // ── No results ──
  if (!results.length) return (
    <div className="py-14 max-w-lg">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-card2 border border-border flex items-center justify-center flex-shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-muted">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M11 8v6M11 16h.01" strokeLinecap="round"/>
          </svg>
        </div>
        <div>
          <p className="text-content text-base font-semibold font-khmer">
            No results for &ldquo;{query}&rdquo;
          </p>
          <p className="text-muted text-sm mt-0.5">The crawler is still building the index</p>
        </div>
      </div>
      <div className="bg-card border border-border rounded-xl p-4 space-y-3 text-sm text-muted">
        <p className="flex items-start gap-2">
          <span className="text-yellow mt-0.5">⚡</span>
          <span>Our crawler is actively indexing pages. Results for this query may appear within minutes as new pages are discovered.</span>
        </p>
        <p className="flex items-start gap-2">
          <span className="text-blue mt-0.5">💡</span>
          <span>Try shorter keywords, English terms, or check the <strong className="text-content">News</strong> or <strong className="text-content">Dev</strong> tabs above.</span>
        </p>
        <p className="flex items-start gap-2">
          <span className="text-green mt-0.5">🌱</span>
          <span>You can add new seed domains in the <a href="/admin" className="text-blue hover:underline">Admin panel</a> to help the crawler discover more content.</span>
        </p>
      </div>
    </div>
  )

  // ── All / Web ──
  if (tab === 'all') {
    return (
      <div>
        <AIOverview answer={aiAnswer} model={aiModel} loading={aiLoading} />
        <p className="text-muted text-xs mb-4">About {results.length.toLocaleString()} results</p>
        <TopResult result={results[0]} query={query} onBookmark={save} />
        {results.slice(1).map((r, i) => (
          <div key={r.id ?? i}>
            <WebResult result={r} query={query} index={i} onBookmark={save} />
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

  // ── Images ──
  if (tab === 'image') {
    return (
      <div>
        <div className="columns-2 sm:columns-3 gap-3">
          {results.map((r, i) => <ImageResult key={r.url + i} result={r} index={i} />)}
        </div>
        <Pagination page={page} hasMore={results.length === 10} onPage={goPage} />
      </div>
    )
  }

  // ── Videos ──
  if (tab === 'video') {
    return (
      <div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {results.map((r, i) => <VideoResult key={r.id ?? i} result={r} index={i} />)}
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
        {results.map((r, i) => <GithubResult key={r.id ?? i} result={r} index={i} onBookmark={save} />)}
        <Pagination page={page} hasMore={results.length === 10} onPage={goPage} />
      </div>
    )
  }

  return null
}
