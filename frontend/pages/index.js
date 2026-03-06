import { useState, useEffect, useRef } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'

// ── Tab config ──
const TABS = [
  { id: 'web',       label: '🔍 ស្វែងរក',    en: 'Web'     },
  { id: 'news',      label: '📰 ព័ត៌មាន',    en: 'News'    },
  { id: 'image',     label: '🖼️ រូបភាព',     en: 'Images'  },
  { id: 'video',     label: '▶️ វីដេអូ',      en: 'Videos'  },
  { id: 'github',    label: '💻 GitHub',      en: 'GitHub'  },
  { id: 'bookmarks', label: '🔖 Bookmarks',   en: 'Saved'   },
  { id: 'history',   label: '🕐 History',     en: 'History' },
]

const USER_ID = 1 // TODO: replace with real auth

export default function Home() {
  const router = useRouter()
  const inputRef = useRef(null)

  const [query,     setQuery]     = useState('')
  const [results,   setResults]   = useState([])
  const [suggests,  setSuggests]  = useState([])
  const [loading,   setLoading]   = useState(false)
  const [searched,  setSearched]  = useState(false)
  const [tab,       setTab]       = useState('web')
  const [lang,      setLang]      = useState('')
  const [page,      setPage]      = useState(1)
  const [showSug,   setShowSug]   = useState(false)
  const [bookmarks, setBookmarks] = useState([])
  const [history,   setHistory]   = useState([])
  const [stats,     setStats]     = useState(null)

  // Load stats on mount
  useEffect(() => {
    fetch(`${API}/stats`).then(r=>r.json()).then(setStats).catch(()=>{})
  }, [])

  // Restore query from URL
  useEffect(() => {
    if (router.query.q) {
      setQuery(router.query.q)
      const t = router.query.type || 'web'
      setTab(t)
      doSearch(router.query.q, 1, lang, t)
    }
  }, [router.query.q])

  // Autocomplete
  useEffect(() => {
    if (query.length < 1) { setSuggests([]); return }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`${API}/suggest?q=${encodeURIComponent(query)}`)
        const d = await r.json()
        setSuggests(d.suggestions || [])
        setShowSug(true)
      } catch(e) {}
    }, 150)
    return () => clearTimeout(t)
  }, [query])

  async function doSearch(q, pg=1, lg=lang, tp=tab) {
    if (!q.trim()) return
    setLoading(true); setSearched(true); setShowSug(false)
    router.push(`/?q=${encodeURIComponent(q)}&type=${tp}`, undefined, {shallow:true})
    try {
      let url = `${API}/search?q=${encodeURIComponent(q)}&type=${tp}&page=${pg}`
      if (lg) url += `&lang=${lg}`
      const r = await fetch(url)
      const d = await r.json()
      setResults(d.results || [])
      setPage(pg)
    } catch(e) { setResults([]) }
    setLoading(false)
  }

  function switchTab(t) {
    setTab(t)
    if (t === 'bookmarks') { loadBookmarks(); return }
    if (t === 'history')   { loadHistory();   return }
    if (searched && query) doSearch(query, 1, lang, t)
  }

  async function loadBookmarks() {
    const r = await fetch(`${API}/bookmarks?user_id=${USER_ID}`)
    const d = await r.json()
    setBookmarks(d.bookmarks || [])
  }

  async function loadHistory() {
    const r = await fetch(`${API}/history?user_id=${USER_ID}`)
    const d = await r.json()
    setHistory(d.history || [])
  }

  async function saveBookmark(url, title) {
    await fetch(`${API}/bookmark`, {
      method: 'POST',
      headers: {'Content-Type':'application/x-www-form-urlencoded'},
      body: `user_id=${USER_ID}&url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`
    })
    alert('Bookmarked! 🔖')
  }

  async function clearHistory() {
    await fetch(`${API}/history?user_id=${USER_ID}`, {method:'DELETE'})
    setHistory([])
  }

  const quickSearches = ['ភ្នំពេញ','អង្គរវត្ត','Cambodia tech','Phnom Penh startup','Khmer developer','Cambodia economy']

  return (
    <>
      <Head>
        <title>{searched ? `${query} — AngkorSearch` : 'AngkorSearch 🇰🇭'}</title>
        <meta name="description" content="Cambodia's search engine — Khmer and English, Web, News, Images, Videos, GitHub" />
      </Head>

      <div className="app">
        {/* ══ HEADER ══ */}
        <header className={searched ? 'hdr hdr-sm' : 'hdr hdr-lg'}>
          <div className="logo" onClick={() => { setSearched(false); setQuery(''); setResults([]); router.push('/') }}>
            <span style={{color:'#1a73e8'}}>Angkor</span>
            <span style={{color:'#ea4335'}}>Search</span>
            <span style={{marginLeft:6}}>🇰🇭</span>
          </div>

          {/* Search box */}
          <div className="sbox-wrap">
            <div className="sbox">
              <span className="sico">🔍</span>
              <input ref={inputRef} value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if(e.key==='Enter'){ doSearch(query,1,lang,tab) } }}
                onFocus={() => setShowSug(true)}
                onBlur={() => setTimeout(()=>setShowSug(false),200)}
                placeholder="ស្វែងរក Cambodia, Khmer, GitHub..."
                className="sinput" autoComplete="off" />
              {query && <button className="sclear" onClick={() => { setQuery(''); setSuggests([]) }}>✕</button>}
              <button className="sbtn" onClick={() => doSearch(query,1,lang,tab)}>ស្វែងរក</button>
            </div>

            {/* Suggestions dropdown */}
            {showSug && suggests.length > 0 && (
              <div className="sugbox">
                {suggests.map((s,i) => (
                  <div key={i} className="sugitem"
                    onMouseDown={() => { setQuery(s); doSearch(s,1,lang,tab) }}>
                    <span style={{color:'#9aa0a6',marginRight:8}}>🔍</span>{s}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tabs + lang filter */}
          {searched && (
            <div className="tabs">
              {TABS.map(t => (
                <button key={t.id}
                  className={`tab ${tab===t.id?'tab-on':''}`}
                  onClick={() => switchTab(t.id)}>
                  {t.label}
                </button>
              ))}
              <select className="langsel" value={lang}
                onChange={e => { setLang(e.target.value); if(searched) doSearch(query,1,e.target.value,tab) }}>
                <option value="">🌐 All</option>
                <option value="km">🇰🇭 ខ្មែរ</option>
                <option value="en">🇬🇧 English</option>
              </select>
            </div>
          )}
        </header>

        {/* ══ HERO (not searched) ══ */}
        {!searched && (
          <div className="hero">
            <p className="hero-sub">ម៉ាស៊ីនស្វែងរកសម្រាប់កម្ពុជា · Web · News · Images · Videos · GitHub</p>
            {stats && (
              <div className="stats-row">
                <div className="stat-box"><strong>{Number(stats.pages).toLocaleString()}</strong><span>Pages</span></div>
                <div className="stat-box"><strong>{Number(stats.images).toLocaleString()}</strong><span>Images</span></div>
                <div className="stat-box"><strong>{Number(stats.videos).toLocaleString()}</strong><span>Videos</span></div>
                <div className="stat-box"><strong>{Number(stats.github).toLocaleString()}</strong><span>GitHub Repos</span></div>
                <div className="stat-box"><strong>{Number(stats.news).toLocaleString()}</strong><span>News</span></div>
              </div>
            )}
            <div className="quick-links">
              {quickSearches.map(s => (
                <button key={s} className="qbtn"
                  onClick={() => { setQuery(s); doSearch(s,1,lang,'web') }}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {/* ══ MAIN CONTENT ══ */}
        <main className="main">
          {loading && (
            <div className="loading">
              <div className="spinner" /><span>កំពុងស្វែងរក...</span>
            </div>
          )}

          {/* ── Web Results ── */}
          {tab==='web' && !loading && results.length>0 && (
            <div>
              <p className="rcount">{results.length} results</p>
              {results.map((r,i) => (
                <div key={i} className="rcard">
                  <div className="rurl">{r.url}</div>
                  <a href={r.url} target="_blank" rel="noreferrer" className="rtitle">{r.title||r.url}</a>
                  {r.description && <p className="rdesc">{r.description}</p>}
                  <p className="rsnip" dangerouslySetInnerHTML={{__html: r.snippet}} />
                  <div className="rmeta">
                    <span className={`lbadge lb-${r.lang}`}>{r.lang==='km'?'🇰🇭 ខ្មែរ':r.lang==='en'?'🇬🇧 EN':'🌐'}</span>
                    <span className="tbadge">{r.type}</span>
                    <button className="bkbtn" onClick={()=>saveBookmark(r.url,r.title)}>🔖 Save</button>
                  </div>
                </div>
              ))}
              <div className="pager">
                {page>1 && <button onClick={()=>doSearch(query,page-1,lang,tab)}>← Prev</button>}
                <span>Page {page}</span>
                {results.length===10 && <button onClick={()=>doSearch(query,page+1,lang,tab)}>Next →</button>}
              </div>
            </div>
          )}

          {/* ── News Results ── */}
          {tab==='news' && !loading && results.length>0 && (
            <div className="news-grid">
              {results.map((r,i) => (
                <a key={i} href={r.url} target="_blank" rel="noreferrer" className="news-card">
                  {r.image && <img src={r.image} alt={r.title} className="news-img" onError={e=>e.target.style.display='none'} />}
                  <div className="news-body">
                    <div className="news-src">{r.source}</div>
                    <div className="news-title">{r.title}</div>
                    <div className="news-desc">{r.desc}</div>
                    {r.published && <div className="news-date">{new Date(r.published).toLocaleDateString()}</div>}
                  </div>
                </a>
              ))}
            </div>
          )}

          {/* ── Image Results ── */}
          {tab==='image' && !loading && results.length>0 && (
            <div className="img-grid">
              {results.map((r,i) => (
                <a key={i} href={r.page_url||r.url} target="_blank" rel="noreferrer" className="img-card">
                  <img src={r.url} alt={r.alt||'image'} className="img-thumb"
                    onError={e=>e.target.closest('.img-card').style.display='none'} />
                  <div className="img-alt">{r.alt}</div>
                </a>
              ))}
            </div>
          )}

          {/* ── Video Results ── */}
          {tab==='video' && !loading && results.length>0 && (
            <div className="vid-grid">
              {results.map((r,i) => (
                <a key={i} href={r.url} target="_blank" rel="noreferrer" className="vid-card">
                  {r.thumb ? (
                    <img src={r.thumb} alt={r.title} className="vid-thumb" />
                  ) : (
                    <div className="vid-placeholder">▶️</div>
                  )}
                  <div className="vid-info">
                    <div className="vid-title">{r.title}</div>
                    {r.channel && <div className="vid-ch">📺 {r.channel}</div>}
                    <div className="vid-desc">{r.desc?.substr(0,100)}</div>
                  </div>
                </a>
              ))}
            </div>
          )}

          {/* ── GitHub Results ── */}
          {tab==='github' && !loading && results.length>0 && (
            <div>
              <p className="rcount">{results.length} Cambodian repositories</p>
              {results.map((r,i) => (
                <div key={i} className="gh-card">
                  <a href={r.url} target="_blank" rel="noreferrer" className="gh-name">
                    📁 {r.full_name||r.name}
                  </a>
                  <p className="gh-desc">{r.desc||'No description'}</p>
                  <div className="gh-meta">
                    {r.lang && <span className="gh-lang">● {r.lang}</span>}
                    <span>⭐ {r.stars}</span>
                    <span>🍴 {r.forks}</span>
                    <span>👤 {r.owner}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Bookmarks ── */}
          {tab==='bookmarks' && (
            <div>
              <h2 style={{marginBottom:16}}>🔖 Your Bookmarks</h2>
              {bookmarks.length===0 && <p style={{color:'#5f6368'}}>No bookmarks yet. Click 🔖 Save on any result.</p>}
              {bookmarks.map((b,i) => (
                <div key={i} className="rcard">
                  <a href={b.url} target="_blank" rel="noreferrer" className="rtitle">{b.title||b.url}</a>
                  <div className="rurl">{b.url}</div>
                  <div className="rmeta"><span>📁 {b.folder}</span><span>{new Date(b.saved_at).toLocaleDateString()}</span></div>
                </div>
              ))}
            </div>
          )}

          {/* ── History ── */}
          {tab==='history' && (
            <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                <h2>🕐 Search History</h2>
                {history.length>0 && <button className="clrbtn" onClick={clearHistory}>🗑 Clear All</button>}
              </div>
              {history.length===0 && <p style={{color:'#5f6368'}}>No search history.</p>}
              {history.map((h,i) => (
                <div key={i} className="hist-item"
                  onClick={() => { setTab(h.type||'web'); setQuery(h.query); doSearch(h.query,1,lang,h.type||'web') }}>
                  <div><span style={{marginRight:8}}>🔍</span>{h.query}</div>
                  <div className="hist-meta">{h.results} results · {h.type} · {new Date(h.at).toLocaleDateString()}</div>
                </div>
              ))}
            </div>
          )}

          {/* No results */}
          {!loading && searched && results.length===0 &&
           tab!=='bookmarks' && tab!=='history' && (
            <div className="nores">
              <div style={{fontSize:48}}>😔</div>
              <p>No results for "<strong>{query}</strong>" in {tab}</p>
              <p style={{color:'#9aa0a6',marginTop:8}}>Try different keywords or switch tabs</p>
            </div>
          )}
        </main>

        <footer className="footer">
          <p>AngkorSearch v2.0 🇰🇭 · Open Source · Web · News · Images · Videos · GitHub</p>
        </footer>
      </div>

      <style jsx global>{`
        *{box-sizing:border-box;margin:0;padding:0;}
        body{font-family:'Segoe UI',system-ui,sans-serif;background:#f8f9fa;color:#202124;}
        .app{min-height:100vh;display:flex;flex-direction:column;}

        /* Header */
        .hdr{background:#fff;border-bottom:1px solid #e0e0e0;padding:16px 24px;}
        .hdr-lg{display:flex;flex-direction:column;align-items:center;padding:60px 24px 30px;border:none;background:transparent;}
        .hdr-sm{display:flex;flex-direction:column;align-items:flex-start;}
        .logo{cursor:pointer;font-size:32px;font-weight:900;margin-bottom:20px;user-select:none;}
        .hdr-sm .logo{font-size:22px;margin-bottom:10px;}

        /* Search box */
        .sbox-wrap{width:100%;max-width:660px;position:relative;}
        .sbox{display:flex;align-items:center;background:#fff;border:1.5px solid #dfe1e5;border-radius:28px;padding:8px 16px;gap:8px;box-shadow:0 2px 8px rgba(0,0,0,.08);}
        .sbox:focus-within{border-color:#1a73e8;box-shadow:0 2px 12px rgba(26,115,232,.2);}
        .sico{font-size:18px;color:#9aa0a6;}
        .sinput{flex:1;border:none;outline:none;font-size:16px;background:transparent;font-family:inherit;}
        .sclear{background:none;border:none;cursor:pointer;color:#9aa0a6;padding:4px;font-size:14px;}
        .sbtn{background:#1a73e8;color:#fff;border:none;border-radius:20px;padding:8px 20px;cursor:pointer;font-size:14px;white-space:nowrap;}
        .sbtn:hover{background:#1557b0;}

        /* Suggestions */
        .sugbox{position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #dfe1e5;border-radius:12px;margin-top:4px;z-index:100;box-shadow:0 4px 16px rgba(0,0,0,.12);overflow:hidden;}
        .sugitem{padding:10px 16px;cursor:pointer;font-size:15px;}
        .sugitem:hover{background:#f1f3f4;}

        /* Tabs */
        .tabs{display:flex;gap:4px;margin-top:10px;flex-wrap:wrap;align-items:center;}
        .tab{background:none;border:none;padding:7px 14px;border-radius:20px;cursor:pointer;font-size:13px;color:#5f6368;white-space:nowrap;}
        .tab:hover{background:#f1f3f4;}
        .tab-on{color:#1a73e8;background:#e8f0fe;font-weight:600;}
        .langsel{margin-left:auto;padding:6px 10px;border-radius:20px;border:1px solid #dfe1e5;font-size:13px;background:#fff;cursor:pointer;}

        /* Hero */
        .hero{text-align:center;padding:20px;}
        .hero-sub{color:#5f6368;font-size:15px;margin-bottom:20px;}
        .stats-row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:20px;}
        .stat-box{background:#fff;border-radius:12px;padding:12px 20px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.08);}
        .stat-box strong{display:block;font-size:20px;color:#1a73e8;}
        .stat-box span{font-size:12px;color:#5f6368;}
        .quick-links{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;}
        .qbtn{background:#fff;border:1px solid #dfe1e5;border-radius:20px;padding:8px 16px;cursor:pointer;font-size:14px;}
        .qbtn:hover{border-color:#1a73e8;color:#1a73e8;}

        /* Main */
        .main{flex:1;max-width:800px;margin:0 auto;width:100%;padding:20px 16px;}
        .rcount{color:#70757a;font-size:13px;margin-bottom:14px;}

        /* Web result card */
        .rcard{background:#fff;border-radius:12px;padding:16px 20px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,.08);}
        .rcard:hover{box-shadow:0 4px 12px rgba(0,0,0,.12);}
        .rurl{font-size:12px;color:#3c4043;margin-bottom:3px;}
        .rtitle{font-size:18px;color:#1a0dab;text-decoration:none;display:block;margin-bottom:5px;font-weight:500;}
        .rtitle:hover{text-decoration:underline;}
        .rdesc{font-size:13px;color:#70757a;margin-bottom:5px;}
        .rsnip{font-size:14px;color:#4d5156;line-height:1.6;}
        .rsnip b{font-weight:700;color:#202124;}
        .rmeta{display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap;}
        .lbadge{font-size:12px;padding:2px 10px;border-radius:10px;background:#f1f3f4;}
        .lb-km{background:#fce8e6;color:#c5221f;}
        .lb-en{background:#e8f0fe;color:#1a73e8;}
        .tbadge{font-size:11px;padding:2px 8px;border-radius:10px;background:#e6f4ea;color:#137333;}
        .bkbtn{margin-left:auto;background:none;border:1px solid #dfe1e5;border-radius:10px;padding:3px 10px;cursor:pointer;font-size:12px;}
        .bkbtn:hover{background:#f1f3f4;}

        /* News grid */
        .news-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;}
        .news-card{background:#fff;border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;box-shadow:0 1px 3px rgba(0,0,0,.08);display:flex;flex-direction:column;}
        .news-card:hover{box-shadow:0 4px 12px rgba(0,0,0,.15);}
        .news-img{width:100%;height:160px;object-fit:cover;}
        .news-body{padding:12px;}
        .news-src{font-size:11px;color:#9aa0a6;text-transform:uppercase;margin-bottom:4px;}
        .news-title{font-size:15px;font-weight:600;line-height:1.4;margin-bottom:6px;}
        .news-desc{font-size:13px;color:#5f6368;line-height:1.4;}
        .news-date{font-size:11px;color:#9aa0a6;margin-top:8px;}

        /* Image grid */
        .img-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;}
        .img-card{background:#fff;border-radius:10px;overflow:hidden;text-decoration:none;color:inherit;}
        .img-card:hover{box-shadow:0 4px 12px rgba(0,0,0,.15);}
        .img-thumb{width:100%;height:140px;object-fit:cover;display:block;}
        .img-alt{font-size:11px;padding:6px 8px;color:#5f6368;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

        /* Video grid */
        .vid-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;}
        .vid-card{background:#fff;border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;box-shadow:0 1px 3px rgba(0,0,0,.08);}
        .vid-card:hover{box-shadow:0 4px 12px rgba(0,0,0,.15);}
        .vid-thumb{width:100%;height:158px;object-fit:cover;display:block;}
        .vid-placeholder{width:100%;height:158px;background:#f1f3f4;display:flex;align-items:center;justify-content:center;font-size:48px;}
        .vid-info{padding:12px;}
        .vid-title{font-size:15px;font-weight:600;margin-bottom:4px;line-height:1.4;}
        .vid-ch{font-size:12px;color:#5f6368;margin-bottom:4px;}
        .vid-desc{font-size:12px;color:#9aa0a6;}

        /* GitHub cards */
        .gh-card{background:#fff;border-radius:12px;padding:16px 20px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,.08);}
        .gh-card:hover{box-shadow:0 4px 12px rgba(0,0,0,.12);}
        .gh-name{font-size:18px;color:#1a0dab;text-decoration:none;display:block;margin-bottom:6px;font-weight:500;}
        .gh-name:hover{text-decoration:underline;}
        .gh-desc{font-size:14px;color:#5f6368;margin-bottom:10px;}
        .gh-meta{display:flex;gap:14px;font-size:13px;color:#5f6368;flex-wrap:wrap;}
        .gh-lang{color:#ea4335;}

        /* Pagination */
        .pager{display:flex;gap:12px;align-items:center;justify-content:center;margin-top:24px;}
        .pager button{padding:8px 20px;border:1px solid #dfe1e5;border-radius:20px;background:#fff;cursor:pointer;}
        .pager button:hover{background:#f1f3f4;}

        /* Loading */
        .loading{display:flex;align-items:center;gap:12px;padding:40px;justify-content:center;color:#5f6368;}
        .spinner{width:24px;height:24px;border:3px solid #f3f3f3;border-top-color:#1a73e8;border-radius:50%;animation:spin .8s linear infinite;}
        @keyframes spin{to{transform:rotate(360deg)}}

        /* No results */
        .nores{text-align:center;padding:60px 20px;color:#5f6368;}

        /* History / Bookmarks */
        .hist-item{background:#fff;border-radius:10px;padding:12px 16px;margin-bottom:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;box-shadow:0 1px 2px rgba(0,0,0,.06);}
        .hist-item:hover{background:#f8f9fa;}
        .hist-meta{font-size:12px;color:#9aa0a6;}
        .clrbtn{background:#fce8e6;color:#c5221f;border:none;border-radius:20px;padding:6px 16px;cursor:pointer;font-size:13px;}

        /* Footer */
        .footer{text-align:center;padding:20px;color:#9aa0a6;font-size:13px;border-top:1px solid #e0e0e0;}

        @media(max-width:600px){
          .tabs{gap:2px;} .tab{padding:6px 8px;font-size:11px;}
          .news-grid,.vid-grid{grid-template-columns:1fr;}
          .img-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr));}
        }
      `}</style>
    </>
  )
}