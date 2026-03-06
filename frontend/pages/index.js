import { useState, useEffect, useRef } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'

export default function Home() {
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState([])
  const [suggests, setSuggests] = useState([])
  const [loading, setLoading]   = useState(false)
  const [searched, setSearched] = useState(false)
  const [page, setPage]         = useState(1)
  const [lang, setLang]         = useState('')
  const [tab, setTab]           = useState('search') // search | news | bookmarks | history
  const [bookmarks, setBookmarks] = useState([])
  const [history, setHistory]     = useState([])
  const [showSuggest, setShowSuggest] = useState(false)
  const inputRef = useRef(null)
  const router = useRouter()
  const userId = 1 // TODO: replace with real auth

  // Load query from URL
  useEffect(() => {
    if (router.query.q) {
      setQuery(router.query.q)
      doSearch(router.query.q, 1, lang)
    }
  }, [router.query.q])

  // Autocomplete
  useEffect(() => {
    if (query.length < 2) { setSuggests([]); return }
    const t = setTimeout(async () => {
      const r = await fetch(`${API}/suggest?q=${encodeURIComponent(query)}`)
      const d = await r.json()
      setSuggests(d.suggestions || [])
      setShowSuggest(true)
    }, 200)
    return () => clearTimeout(t)
  }, [query])

  async function doSearch(q, pg = 1, lg = lang) {
    if (!q.trim()) return
    setLoading(true)
    setSearched(true)
    setShowSuggest(false)
    router.push(`/?q=${encodeURIComponent(q)}`, undefined, { shallow: true })

    try {
      let url = `${API}/search?q=${encodeURIComponent(q)}&page=${pg}`
      if (lg) url += `&lang=${lg}`
      const r = await fetch(url)
      const d = await r.json()
      setResults(d.results || [])
      setPage(pg)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  async function loadBookmarks() {
    const r = await fetch(`${API}/bookmarks?user_id=${userId}`)
    const d = await r.json()
    setBookmarks(d.bookmarks || [])
  }

  async function loadHistory() {
    const r = await fetch(`${API}/history?user_id=${userId}`)
    const d = await r.json()
    setHistory(d.history || [])
  }

  async function saveBookmark(result) {
    await fetch(`${API}/bookmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `user_id=${userId}&url=${encodeURIComponent(result.url)}&title=${encodeURIComponent(result.title)}`
    })
    alert('Bookmarked!')
  }

  async function clearHistory() {
    await fetch(`${API}/history?user_id=${userId}`, { method: 'DELETE' })
    setHistory([])
  }

  const handleTab = (t) => {
    setTab(t)
    if (t === 'bookmarks') loadBookmarks()
    if (t === 'history')   loadHistory()
  }

  return (
    <>
      <Head>
        <title>{searched ? `${query} - AngkorSearch` : 'AngkorSearch | ស្វែងរក'}</title>
        <meta name="description" content="Cambodia's own search engine - Khmer and English" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="app">
        {/* ── Header ── */}
        <header className={`header ${searched ? 'header-small' : 'header-big'}`}>
          <div className="logo" onClick={() => { setSearched(false); setQuery(''); setResults([]); router.push('/') }}>
            <span className="logo-angkor">Angkor</span>
            <span className="logo-search">Search</span>
            <span className="logo-kh">🇰🇭</span>
          </div>

          {/* Search box */}
          <div className="search-wrap">
            <div className="search-box">
              <span className="search-icon">🔍</span>
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doSearch(query)}
                onFocus={() => setSuggests(s => s) && setShowSuggest(true)}
                placeholder="ស្វែងរក... Search Cambodia"
                className="search-input"
                autoComplete="off"
              />
              {query && <button className="clear-btn" onClick={() => { setQuery(''); setSuggests([]); inputRef.current.focus() }}>✕</button>}
              <button className="search-btn" onClick={() => doSearch(query)}>ស្វែងរក</button>
            </div>

            {/* Suggestions */}
            {showSuggest && suggests.length > 0 && (
              <div className="suggest-box">
                {suggests.map((s, i) => (
                  <div key={i} className="suggest-item"
                    onClick={() => { setQuery(s); doSearch(s); }}>
                    🔍 {s}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tabs */}
          {searched && (
            <div className="tabs">
              {['search','news','bookmarks','history'].map(t => (
                <button key={t}
                  className={`tab ${tab === t ? 'tab-active' : ''}`}
                  onClick={() => handleTab(t)}>
                  {t === 'search'    ? '🔍 ស្វែងរក'  : ''}
                  {t === 'news'      ? '📰 ព័ត៌មាន'  : ''}
                  {t === 'bookmarks' ? '🔖 Bookmarks' : ''}
                  {t === 'history'   ? '🕐 History'   : ''}
                </button>
              ))}

              {/* Lang filter */}
              <select className="lang-select" value={lang}
                onChange={e => { setLang(e.target.value); doSearch(query, 1, e.target.value) }}>
                <option value="">🌐 All Languages</option>
                <option value="km">🇰🇭 Khmer</option>
                <option value="en">🇬🇧 English</option>
              </select>
            </div>
          )}
        </header>

        {/* ── Hero (when not searched) ── */}
        {!searched && (
          <div className="hero">
            <p className="hero-sub">ម៉ាស៊ីនស្វែងរកសម្រាប់កម្ពុជា · Cambodia's own search engine</p>
            <div className="quick-links">
              {['ព័ត៌មានកម្ពុជា', 'អង្គរវត្ត', 'Cambodia economy', 'Phnom Penh tech'].map(s => (
                <button key={s} className="quick-btn" onClick={() => { setQuery(s); doSearch(s) }}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {/* ── Main content ── */}
        <main className="main">
          {loading && (
            <div className="loading">
              <div className="spinner" />
              <span>កំពុងស្វែងរក...</span>
            </div>
          )}

          {/* Search Results */}
          {tab === 'search' && !loading && results.length > 0 && (
            <div className="results">
              <p className="result-count">{results.length} results</p>
              {results.map((r, i) => (
                <div key={i} className="result-card">
                  <div className="result-url">{r.url}</div>
                  <a href={r.url} target="_blank" rel="noreferrer" className="result-title">{r.title || r.url}</a>
                  <p className="result-snippet" dangerouslySetInnerHTML={{ __html: r.snippet }} />
                  <div className="result-meta">
                    <span className={`lang-badge lang-${r.lang}`}>{r.lang === 'km' ? '🇰🇭 ខ្មែរ' : r.lang === 'en' ? '🇬🇧 EN' : '🌐 Mixed'}</span>
                    <button className="bookmark-btn" onClick={() => saveBookmark(r)}>🔖 Save</button>
                  </div>
                </div>
              ))}

              {/* Pagination */}
              <div className="pagination">
                {page > 1 && <button onClick={() => doSearch(query, page - 1)}>← Prev</button>}
                <span>Page {page}</span>
                {results.length === 10 && <button onClick={() => doSearch(query, page + 1)}>Next →</button>}
              </div>
            </div>
          )}

          {tab === 'search' && !loading && searched && results.length === 0 && (
            <div className="no-results">
              <p>😔 No results for "<strong>{query}</strong>"</p>
              <p>Try searching in Khmer or English</p>
            </div>
          )}

          {/* Bookmarks */}
          {tab === 'bookmarks' && (
            <div className="bookmarks-list">
              <h2>🔖 Your Bookmarks</h2>
              {bookmarks.length === 0 && <p>No bookmarks yet. Click 🔖 Save on any result.</p>}
              {bookmarks.map((b, i) => (
                <div key={i} className="result-card">
                  <a href={b.url} target="_blank" rel="noreferrer" className="result-title">{b.title || b.url}</a>
                  <div className="result-url">{b.url}</div>
                  <div className="result-meta"><span>📁 {b.folder}</span><span>{new Date(b.saved_at).toLocaleDateString()}</span></div>
                </div>
              ))}
            </div>
          )}

          {/* History */}
          {tab === 'history' && (
            <div className="history-list">
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <h2>🕐 Search History</h2>
                {history.length > 0 && <button className="clear-history-btn" onClick={clearHistory}>🗑 Clear All</button>}
              </div>
              {history.length === 0 && <p>No search history.</p>}
              {history.map((h, i) => (
                <div key={i} className="history-item" onClick={() => { setTab('search'); setQuery(h.query); doSearch(h.query) }}>
                  <span>🔍 {h.query}</span>
                  <span className="history-meta">{h.results} results · {new Date(h.at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </main>

        {/* ── Footer ── */}
        <footer className="footer">
          <p>AngkorSearch 🇰🇭 — Open Source Search Engine for Cambodia</p>
          <p style={{fontSize:'12px', marginTop:'4px', opacity:0.6}}>Built with C++ · PostgreSQL · Next.js</p>
        </footer>
      </div>

      <style jsx global>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', sans-serif; background: #f8f9fa; color: #202124; }

        .app { min-height: 100vh; display: flex; flex-direction: column; }

        /* Header */
        .header { background: white; border-bottom: 1px solid #e0e0e0; padding: 16px 24px; }
        .header-big { display: flex; flex-direction: column; align-items: center; padding: 60px 24px 30px; border: none; background: transparent; }
        .header-small { display: flex; flex-direction: column; align-items: flex-start; }

        /* Logo */
        .logo { cursor: pointer; font-size: 36px; font-weight: 900; margin-bottom: 24px; user-select: none; }
        .header-small .logo { font-size: 24px; margin-bottom: 12px; }
        .logo-angkor { color: #1a73e8; }
        .logo-search { color: #ea4335; }
        .logo-kh { margin-left: 8px; }

        /* Search */
        .search-wrap { width: 100%; max-width: 640px; position: relative; }
        .search-box { display: flex; align-items: center; background: white; border: 1.5px solid #dfe1e5; border-radius: 28px; padding: 8px 16px; gap: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        .search-box:focus-within { border-color: #1a73e8; box-shadow: 0 2px 12px rgba(26,115,232,0.2); }
        .search-icon { font-size: 18px; color: #9aa0a6; }
        .search-input { flex: 1; border: none; outline: none; font-size: 16px; font-family: inherit; background: transparent; }
        .clear-btn { background: none; border: none; cursor: pointer; font-size: 14px; color: #9aa0a6; padding: 4px; }
        .search-btn { background: #1a73e8; color: white; border: none; border-radius: 20px; padding: 8px 20px; cursor: pointer; font-size: 14px; white-space: nowrap; }
        .search-btn:hover { background: #1557b0; }

        /* Suggest */
        .suggest-box { position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid #dfe1e5; border-radius: 12px; margin-top: 4px; overflow: hidden; z-index: 100; box-shadow: 0 4px 16px rgba(0,0,0,0.12); }
        .suggest-item { padding: 10px 16px; cursor: pointer; font-size: 14px; }
        .suggest-item:hover { background: #f1f3f4; }

        /* Tabs */
        .tabs { display: flex; gap: 4px; margin-top: 12px; align-items: center; flex-wrap: wrap; }
        .tab { background: none; border: none; padding: 8px 16px; border-radius: 20px; cursor: pointer; font-size: 14px; color: #5f6368; }
        .tab:hover { background: #f1f3f4; }
        .tab-active { color: #1a73e8; background: #e8f0fe; font-weight: 600; }
        .lang-select { margin-left: auto; padding: 6px 12px; border-radius: 20px; border: 1px solid #dfe1e5; font-size: 13px; cursor: pointer; background: white; }

        /* Hero */
        .hero { text-align: center; padding: 16px; }
        .hero-sub { color: #5f6368; font-size: 15px; margin-bottom: 20px; }
        .quick-links { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
        .quick-btn { background: white; border: 1px solid #dfe1e5; border-radius: 20px; padding: 8px 16px; cursor: pointer; font-size: 14px; }
        .quick-btn:hover { background: #f1f3f4; border-color: #1a73e8; color: #1a73e8; }

        /* Main */
        .main { flex: 1; max-width: 760px; margin: 0 auto; width: 100%; padding: 20px 16px; }
        .result-count { color: #70757a; font-size: 14px; margin-bottom: 16px; }

        /* Results */
        .result-card { background: white; border-radius: 12px; padding: 16px 20px; margin-bottom: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); transition: box-shadow 0.2s; }
        .result-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.12); }
        .result-url { font-size: 13px; color: #3c4043; margin-bottom: 4px; }
        .result-title { font-size: 18px; color: #1a0dab; text-decoration: none; font-weight: 500; display: block; margin-bottom: 6px; }
        .result-title:hover { text-decoration: underline; }
        .result-snippet { font-size: 14px; color: #4d5156; line-height: 1.6; }
        .result-meta { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
        .lang-badge { font-size: 12px; padding: 2px 10px; border-radius: 12px; background: #f1f3f4; }
        .lang-km { background: #fce8e6; color: #c5221f; }
        .lang-en { background: #e8f0fe; color: #1a73e8; }
        .bookmark-btn { background: none; border: 1px solid #dfe1e5; border-radius: 12px; padding: 3px 10px; cursor: pointer; font-size: 12px; margin-left: auto; }
        .bookmark-btn:hover { background: #f1f3f4; }

        /* Pagination */
        .pagination { display: flex; gap: 12px; align-items: center; justify-content: center; margin-top: 24px; }
        .pagination button { padding: 8px 20px; border: 1px solid #dfe1e5; border-radius: 20px; background: white; cursor: pointer; }
        .pagination button:hover { background: #f1f3f4; }

        /* Loading */
        .loading { display: flex; align-items: center; gap: 12px; padding: 40px; justify-content: center; color: #5f6368; }
        .spinner { width: 24px; height: 24px; border: 3px solid #f3f3f3; border-top-color: #1a73e8; border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* No results */
        .no-results { text-align: center; padding: 60px 20px; color: #5f6368; }
        .no-results strong { color: #202124; }

        /* Bookmarks */
        .bookmarks-list h2, .history-list h2 { font-size: 18px; margin-bottom: 16px; }

        /* History */
        .history-item { background: white; border-radius: 10px; padding: 12px 16px; margin-bottom: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
        .history-item:hover { background: #f8f9fa; }
        .history-meta { font-size: 13px; color: #9aa0a6; }
        .clear-history-btn { background: #fce8e6; color: #c5221f; border: none; border-radius: 20px; padding: 6px 16px; cursor: pointer; font-size: 13px; }

        /* Footer */
        .footer { text-align: center; padding: 20px; color: #9aa0a6; font-size: 14px; border-top: 1px solid #e0e0e0; }

        /* Responsive */
        @media (max-width: 600px) {
          .search-btn { padding: 8px 12px; font-size: 13px; }
          .result-title { font-size: 16px; }
          .tabs { gap: 2px; }
          .tab { padding: 6px 10px; font-size: 12px; }
        }
      `}</style>
    </>
  )
}
