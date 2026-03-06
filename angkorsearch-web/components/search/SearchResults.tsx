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

interface Props {
  query: string
  tab:   TabId
  page:  number
  lang:  string
}

export default function SearchResults({ query, tab, page, lang }: Props) {
  const router = useRouter()
  const { results, loading, error, aiAnswer, aiModel, aiLoading, search } = useSearch()
  const { save, bookmarks, history, loadBookmarks, loadHistory, deleteHistory } = useBookmark()

  useEffect(() => {
    if (!query) return
    if (tab === 'bookmarks') { loadBookmarks(); return }
    if (tab === 'history')   { loadHistory();   return }
    search(query, tab, page, lang)
  }, [query, tab, page, lang])

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
    <div className="py-16 text-center space-y-2">
      <div className="text-5xl mb-4">😔</div>
      <p className="text-content text-lg">No results for &ldquo;<strong className="font-khmer">{query}</strong>&rdquo;</p>
      <p className="text-muted text-sm">Try different keywords. The crawler may still be indexing pages.</p>
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

  // ── GitHub ──
  if (tab === 'github') {
    return (
      <div className="space-y-3">
        <p className="text-muted text-xs mb-4">{results.length.toLocaleString()} repositories</p>
        {results.map((r, i) => <GithubResult key={r.id ?? i} result={r} index={i} onBookmark={save} />)}
        <Pagination page={page} hasMore={results.length === 10} onPage={goPage} />
      </div>
    )
  }

  return null
}
