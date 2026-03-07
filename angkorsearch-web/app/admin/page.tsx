'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ThemeToggle from '@/components/ui/ThemeToggle'
import { API_URL } from '@/lib/constants'
import { fetchAdminSystem, updateSeed } from '@/lib/api'
import { useAuth } from '@/lib/AuthContext'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Overview {
  pages: number; images: number; videos: number
  github: number; news: number
  queue_pending: number; queue_done: number; queue_total: number
}
interface DomainStat  { domain: string; count: number }
interface TypeStat    { type: string;   count: number }
interface LangStat    { language: string; count: number }
interface SearchStat  { query: string;  count: number }
interface QueueDomain { domain: string; pending: number; done: number }
interface RecentPage  { url: string; title: string; domain: string; type: string; lang: string; at: string }
interface Seed {
  id: number; url: string; domain: string; type: string
  priority: number; active: boolean; added_at: string; page_count: number
}
interface AdminData {
  overview: Overview; by_domain: DomainStat[]; by_type: TypeStat[]
  by_language: LangStat[]; top_searches: SearchStat[]
  queue_by_domain: QueueDomain[]; recent_pages: RecentPage[]
}
interface SystemData {
  db_size_bytes: number; db_size_pretty: string; tables: { name: string; bytes: number }[]
  pages_per_hour: number; pages_per_day: number; queue_progress_pct: number
  crawler_events_5m: number; redis_used_bytes: number; redis_max_bytes: number
  redis_used_human: string; redis_hit_rate: number
  mem_total_kb: number; mem_avail_kb: number
  disk_total_kb: number; disk_avail_kb: number
  api_uptime_sec: number; sys_uptime_sec: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt  = (n: number) => n?.toLocaleString() ?? '0'
const fmtB = (b: number) => {
  if (!b) return '0 B'
  if (b < 1024)       return b + ' B'
  if (b < 1024**2)    return (b/1024).toFixed(1) + ' KB'
  if (b < 1024**3)    return (b/1024**2).toFixed(1) + ' MB'
  return (b/1024**3).toFixed(2) + ' GB'
}
const fmtUptime = (s: number) => {
  if (s < 60)   return `${s}s`
  if (s < 3600) return `${Math.floor(s/60)}m ${s%60}s`
  const h = Math.floor(s/3600); const m = Math.floor((s%3600)/60)
  return `${h}h ${m}m`
}
const timeAgo = (iso: string) => {
  const d = Date.now() - new Date(iso).getTime(), m = Math.floor(d/60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m/60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h/24)}d ago`
}

const TYPE_COLORS: Record<string, string> = {
  news: 'text-blue', web: 'text-green', github: 'text-purple',
  image: 'text-yellow', video: 'text-red',
}
const TYPE_OPTIONS = ['web', 'news', 'github', 'image', 'video']
const PRIORITY_PRESETS = [
  { label: 'Force (P1)', value: '1', color: 'border-red/40 bg-red/5 text-red' },
  { label: 'High (P2)',  value: '2', color: 'border-yellow/40 bg-yellow/5 text-yellow' },
  { label: 'Normal (P5)',value: '5', color: 'border-border bg-card2 text-muted' },
  { label: 'Low (P10)', value: '10', color: 'border-border bg-card2 text-muted' },
]

// ── Subcomponents ─────────────────────────────────────────────────────────────
function StatCard({ label, value, color, sub }: { label: string; value: string | number; color: string; sub?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:border-blue/30 transition-all">
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{typeof value === 'number' ? fmt(value) : value}</div>
      <div className="text-muted text-xs mt-1 font-medium">{label}</div>
      {sub && <div className="text-muted/60 text-xs mt-0.5">{sub}</div>}
    </div>
  )
}

function GaugeBar({ pct, color = 'bg-blue', label, sublabel }: { pct: number; color?: string; label: string; sublabel?: string }) {
  const p = Math.min(100, Math.max(0, Math.round(pct)))
  const danger = p > 85
  return (
    <div>
      <div className="flex justify-between items-center text-xs mb-1.5">
        <span className="text-content font-medium">{label}</span>
        <span className={`font-mono font-semibold ${danger ? 'text-red' : 'text-muted'}`}>{p}%</span>
      </div>
      <div className="h-2 bg-hover rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${danger ? 'bg-red' : color}`}
          style={{ width: `${p}%` }}
        />
      </div>
      {sublabel && <div className="text-muted/70 text-xs mt-1">{sublabel}</div>}
    </div>
  )
}

function ActiveToggle({ active, onChange }: { active: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-300 focus:outline-none ${active ? 'bg-green' : 'bg-border'}`}
      title={active ? 'Click to block' : 'Click to allow'}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-300 ${active ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  )
}

function InlinePriority({ seed, onUpdate }: { seed: Seed; onUpdate: () => void }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(String(seed.priority))
  const inputRef = useRef<HTMLInputElement>(null)

  function save() {
    const n = parseInt(val)
    if (!isNaN(n) && n > 0 && n !== seed.priority) {
      updateSeed(seed.id, { priority: n }).then(onUpdate)
    }
    setEditing(false)
  }

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  if (!editing) {
    return (
      <button
        onClick={() => { setVal(String(seed.priority)); setEditing(true) }}
        className="group flex items-center gap-1 px-2 py-0.5 rounded hover:bg-hover transition-all text-xs"
        title="Click to edit priority"
      >
        <span className={`font-mono font-bold ${seed.priority <= 2 ? 'text-red' : seed.priority <= 3 ? 'text-yellow' : 'text-muted'}`}>
          P{seed.priority}
        </span>
        <svg className="opacity-0 group-hover:opacity-100 transition-opacity" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
    )
  }
  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type="number" min={1} max={20}
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
        className="w-14 bg-primary border border-blue rounded px-1.5 py-0.5 text-xs text-content font-mono focus:outline-none"
      />
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
type TabId = 'overview' | 'seeds' | 'queue' | 'system' | 'searches'

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()

  // Auth guard — only admins can see this page.
  // Must wait for authLoading=false before redirecting, otherwise user=null
  // during the initial getMe() fetch causes an immediate unwanted redirect.
  useEffect(() => {
    if (authLoading) return
    if (!user) router.push('/login?next=/admin')
    else if (user.role !== 'admin') router.push('/')
  }, [user, authLoading, router])

  const [data,    setData]    = useState<AdminData | null>(null)
  const [seeds,   setSeeds]   = useState<Seed[]>([])
  const [sysData, setSysData] = useState<SystemData | null>(null)
  const [loading, setLoading] = useState(true)
  const [sysLoading, setSysLoading] = useState(false)
  const [tab,     setTab]     = useState<TabId>('overview')

  // Seed form
  const [addUrl,      setAddUrl]      = useState('')
  const [addType,     setAddType]     = useState('web')
  const [addPriority, setAddPriority] = useState('5')
  const [addMsg,      setAddMsg]      = useState('')
  const [addLoading,  setAddLoading]  = useState(false)

  // Queue form
  const [qUrl,     setQUrl]     = useState('')
  const [qType,    setQType]    = useState('web')
  const [qMsg,     setQMsg]     = useState('')
  const [qLoading, setQLoading] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [statsRes, seedsRes] = await Promise.all([
        fetch(`${API_URL}/admin/stats`),
        fetch(`${API_URL}/admin/seeds`),
      ])
      if (statsRes.ok) setData(await statsRes.json())
      if (seedsRes.ok) { const s = await seedsRes.json(); setSeeds(s.seeds ?? []) }
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  const loadSystem = useCallback(async () => {
    setSysLoading(true)
    try { setSysData(await fetchAdminSystem()) } catch { /* ignore */ }
    setSysLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => {
    if (tab === 'system') {
      loadSystem()
      const iv = setInterval(loadSystem, 8000)
      return () => clearInterval(iv)
    }
  }, [tab, loadSystem])

  async function handleAddSeed(e: React.FormEvent) {
    e.preventDefault()
    if (!addUrl.trim()) return
    setAddLoading(true); setAddMsg('')
    const body = new URLSearchParams({ url: addUrl.trim(), type: addType, priority: addPriority })
    const res = await fetch(`${API_URL}/admin/seeds`, {
      method: 'POST', body: body.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    setAddMsg(res.ok ? 'Seed added and queued for crawling!' : 'Failed to add seed.')
    if (res.ok) { setAddUrl(''); loadData() }
    setAddLoading(false)
  }

  async function handleToggle(seed: Seed) {
    await updateSeed(seed.id, { active: !seed.active })
    loadData()
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this seed permanently?')) return
    await fetch(`${API_URL}/admin/seeds?id=${id}`, { method: 'DELETE' })
    loadData()
  }

  async function handleAddQueue(e: React.FormEvent) {
    e.preventDefault()
    if (!qUrl.trim()) return
    setQLoading(true); setQMsg('')
    const body = new URLSearchParams({ url: qUrl.trim(), type: qType })
    const res = await fetch(`${API_URL}/admin/queue`, {
      method: 'POST', body: body.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    setQMsg(res.ok ? 'URL force-queued at P0 and removed from visited cache!' : 'Failed to add to queue.')
    if (res.ok) { setQUrl(''); loadData() }
    setQLoading(false)
  }

  // Don't render until auth resolves, and never show to non-admins
  if (authLoading || !user || user.role !== 'admin') return null

  const ov = data?.overview
  const sys = sysData

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-primary text-content">

      {/* ── Header ── */}
      <header className="bg-card border-b border-border px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-4">
          <Link href="/" className="opacity-70 hover:opacity-100 transition-opacity">
            <img src="/logo.png" alt="AngkorSearch" className="h-8 w-auto" />
          </Link>
          <div>
            <h1 className="text-base font-bold text-content leading-tight">Admin Dashboard</h1>
            <p className="text-muted text-xs">AngkorSearch Control Panel</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={loadData}
            className="text-xs text-muted hover:text-content border border-border px-3 py-1.5 rounded-full hover:border-blue/50 transition-all flex items-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            Refresh
          </button>
          <Link href="/crawl" className="text-xs bg-blue text-white px-3 py-1.5 rounded-full hover:bg-blue/80 transition-all hidden sm:inline-flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
            Force Crawler
          </Link>
          <Link href="/search?q=Cambodia&tab=all&page=1" className="text-xs border border-border text-muted px-3 py-1.5 rounded-full hover:border-blue/50 hover:text-content transition-all hidden sm:inline-flex">
            Open Search
          </Link>
        </div>
      </header>

      {/* ── Tabs ── */}
      <div className="border-b border-border bg-card px-4 sm:px-6">
        <div className="flex gap-0 overflow-x-auto scrollbar-hide">
          {([
            ['overview', 'Overview'],
            ['seeds',    'Seed Domains'],
            ['queue',    'Crawl Queue'],
            ['system',   'System'],
            ['searches', 'Searches'],
          ] as [TabId, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab === id
                  ? 'border-blue text-blue'
                  : 'border-transparent text-muted hover:text-content'
              }`}
            >
              {label}
              {id === 'seeds' && seeds.length > 0 && (
                <span className="ml-1.5 text-xs bg-border text-muted px-1.5 py-0.5 rounded-full">{seeds.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <main className="px-4 sm:px-6 py-6 max-w-7xl mx-auto space-y-6">

        {loading && tab !== 'system' && (
          <div className="flex items-center justify-center py-24">
            <div className="flex gap-1.5">
              {[0,1,2].map(i => (
                <div key={i} className="w-2.5 h-2.5 rounded-full bg-blue animate-pulse-dot" style={{ animationDelay: `${i*0.15}s` }} />
              ))}
            </div>
          </div>
        )}

        {/* ════════════════ OVERVIEW TAB ════════════════ */}
        {!loading && tab === 'overview' && (
          <>
            {/* Index stats */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted mb-3">Index Overview</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
                <StatCard label="Pages"   value={ov?.pages   ?? 0} color="text-blue"   />
                <StatCard label="Images"  value={ov?.images  ?? 0} color="text-green"  />
                <StatCard label="Videos"  value={ov?.videos  ?? 0} color="text-red"    />
                <StatCard label="GitHub"  value={ov?.github  ?? 0} color="text-purple" />
                <StatCard label="News"    value={ov?.news    ?? 0} color="text-yellow" />
                <StatCard label="Pending" value={ov?.queue_pending ?? 0} color="text-yellow" sub="queue" />
                <StatCard label="Done"    value={ov?.queue_done    ?? 0} color="text-green"  sub="queue" />
                <StatCard label="Total"   value={ov?.queue_total   ?? 0} color="text-content" sub="queue" />
              </div>
            </section>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {/* Top domains */}
              <section className="bg-card border border-border rounded-xl p-5">
                <h3 className="text-sm font-semibold text-content mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue" />
                  Top Domains
                </h3>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {data?.by_domain.map((d, i) => (
                    <div key={d.domain} className="flex items-center gap-2 text-xs py-1 hover:bg-hover px-1.5 rounded transition-colors">
                      <span className="text-muted w-4 text-right flex-shrink-0 font-mono">{i+1}</span>
                      <span className="text-content truncate flex-1 font-mono text-xs">{d.domain}</span>
                      <span className="text-blue font-bold ml-1 flex-shrink-0">{fmt(d.count)}</span>
                    </div>
                  ))}
                </div>
              </section>

              {/* By type + language */}
              <section className="bg-card border border-border rounded-xl p-5">
                <h3 className="text-sm font-semibold text-content mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green" />
                  Content Breakdown
                </h3>
                <div className="space-y-2">
                  {data?.by_type.map(t => {
                    const max = data.by_type[0]?.count ?? 1
                    return (
                      <div key={t.type}>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className={`capitalize font-medium ${TYPE_COLORS[t.type] ?? 'text-muted'}`}>{t.type || 'unknown'}</span>
                          <span className="text-content font-mono">{fmt(t.count)}</span>
                        </div>
                        <div className="h-1 bg-hover rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${TYPE_COLORS[t.type]?.replace('text-','bg-') ?? 'bg-muted'}`} style={{ width: `${Math.round(t.count/max*100)}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="border-t border-border mt-4 pt-3 space-y-1.5">
                  <p className="text-xs font-semibold text-muted mb-2">By Language</p>
                  {data?.by_language.map(l => (
                    <div key={l.language} className="flex justify-between text-xs">
                      <span className="text-content">{l.language==='km'?'🇰🇭 Khmer':l.language==='en'?'🇬🇧 English':l.language||'unknown'}</span>
                      <span className="text-muted font-mono">{fmt(l.count)}</span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Queue by domain */}
              <section className="bg-card border border-border rounded-xl p-5">
                <h3 className="text-sm font-semibold text-content mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-yellow animate-pulse" />
                  Crawl Progress
                </h3>
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {data?.queue_by_domain.map(q => {
                    const total = q.pending + q.done
                    const pct = total > 0 ? Math.round(q.done/total*100) : 0
                    return (
                      <GaugeBar
                        key={q.domain}
                        label={q.domain}
                        pct={pct}
                        color="bg-green"
                        sublabel={`${fmt(q.done)}/${fmt(total)} pages · ${fmt(q.pending)} pending`}
                      />
                    )
                  })}
                </div>
              </section>
            </div>

            {/* Recent pages */}
            <section className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green animate-pulse" />
                <h3 className="text-sm font-semibold text-content">Recently Crawled</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-hover">
                    <tr className="text-muted">
                      <th className="px-5 py-2.5 text-left font-medium">Title</th>
                      <th className="px-4 py-2.5 text-left font-medium">Domain</th>
                      <th className="px-4 py-2.5 text-left font-medium">Type</th>
                      <th className="px-4 py-2.5 text-left font-medium">Lang</th>
                      <th className="px-4 py-2.5 text-left font-medium">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.recent_pages.map((p, i) => (
                      <tr key={i} className="border-t border-border/50 hover:bg-hover transition-colors">
                        <td className="px-5 py-2.5">
                          <a href={p.url} target="_blank" rel="noreferrer" className="text-blue hover:underline font-khmer line-clamp-1 max-w-[260px] block">
                            {p.title || p.url}
                          </a>
                        </td>
                        <td className="px-4 py-2.5 text-muted font-mono">{p.domain}</td>
                        <td className="px-4 py-2.5">
                          <span className={`capitalize font-medium ${TYPE_COLORS[p.type] ?? 'text-muted'}`}>{p.type}</span>
                        </td>
                        <td className="px-4 py-2.5 text-muted">
                          {p.lang==='km'?'🇰🇭':p.lang==='en'?'🇬🇧':p.lang}
                        </td>
                        <td className="px-4 py-2.5 text-muted whitespace-nowrap">{timeAgo(p.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {/* ════════════════ SEEDS TAB ════════════════ */}
        {!loading && tab === 'seeds' && (
          <>
            {/* Add seed form */}
            <section className="bg-card border border-border rounded-xl p-5">
              <h2 className="text-sm font-semibold text-content mb-0.5">Add New Seed Domain</h2>
              <p className="text-xs text-muted mb-4">Seeds are the starting URLs the crawler repeatedly visits and indexes. Choose a priority to control how urgently the crawler processes this domain.</p>

              {/* Priority presets */}
              <div className="flex gap-2 flex-wrap mb-4">
                {PRIORITY_PRESETS.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setAddPriority(p.value)}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${p.color} ${addPriority === p.value ? 'ring-2 ring-blue/50 scale-105' : 'opacity-70 hover:opacity-100'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <form onSubmit={handleAddSeed} className="flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[240px]">
                  <label className="text-xs text-muted block mb-1">Seed URL</label>
                  <input
                    value={addUrl}
                    onChange={e => setAddUrl(e.target.value)}
                    placeholder="https://example.com"
                    className="w-full bg-primary border border-border rounded-lg px-3 py-2 text-sm text-content placeholder:text-muted focus:outline-none focus:border-blue transition-colors"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Content type</label>
                  <select value={addType} onChange={e => setAddType(e.target.value)}
                    className="bg-primary border border-border rounded-lg px-3 py-2 text-sm text-content focus:outline-none focus:border-blue">
                    {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Priority (1–20)</label>
                  <input type="number" min={1} max={20} value={addPriority} onChange={e => setAddPriority(e.target.value)}
                    className="w-20 bg-primary border border-border rounded-lg px-3 py-2 text-sm text-content font-mono focus:outline-none focus:border-blue" />
                </div>
                <button type="submit" disabled={addLoading}
                  className="bg-blue text-white text-sm px-5 py-2 rounded-lg hover:bg-blue/80 disabled:opacity-50 transition-all font-medium flex items-center gap-2">
                  {addLoading ? (
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : '+'}
                  {addLoading ? 'Adding…' : 'Add Seed'}
                </button>
                {addMsg && (
                  <p className={`w-full text-xs font-medium ${addMsg.includes('Failed') ? 'text-red' : 'text-green'}`}>
                    {addMsg.includes('Failed') ? '✗' : '✓'} {addMsg}
                  </p>
                )}
              </form>
            </section>

            {/* Seeds table */}
            <section className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-semibold text-content">
                  Seed Domains
                  <span className="ml-2 text-xs font-normal text-muted">· {seeds.length} total · {seeds.filter(s => !s.active).length} blocked</span>
                </h3>
                <div className="flex gap-3 text-xs text-muted">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 bg-green rounded-full"/>{seeds.filter(s=>s.active).length} active</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red rounded-full"/>{seeds.filter(s=>!s.active).length} blocked</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-hover">
                    <tr className="text-muted">
                      <th className="px-5 py-2.5 text-left font-medium">URL</th>
                      <th className="px-4 py-2.5 text-left font-medium">Type</th>
                      <th className="px-4 py-2.5 text-left font-medium">Priority</th>
                      <th className="px-4 py-2.5 text-left font-medium">Pages</th>
                      <th className="px-4 py-2.5 text-left font-medium">Status</th>
                      <th className="px-4 py-2.5 text-left font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seeds.map(seed => (
                      <tr key={seed.id} className={`border-t border-border/40 transition-all hover:bg-hover ${!seed.active ? 'opacity-50' : ''}`}>
                        <td className="px-5 py-3">
                          <a href={seed.url} target="_blank" rel="noreferrer"
                            className="text-blue hover:underline font-mono text-xs truncate max-w-[200px] block">
                            {seed.url}
                          </a>
                          <span className="text-muted text-xs">{seed.domain}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`capitalize font-medium ${TYPE_COLORS[seed.type] ?? 'text-muted'}`}>{seed.type}</span>
                        </td>
                        <td className="px-4 py-3">
                          <InlinePriority seed={seed} onUpdate={loadData} />
                        </td>
                        <td className="px-4 py-3 text-green font-bold font-mono">{fmt(seed.page_count)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <ActiveToggle active={seed.active} onChange={() => handleToggle(seed)} />
                            <span className={`text-xs ${seed.active ? 'text-green' : 'text-red'}`}>
                              {seed.active ? 'Active' : 'Blocked'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => handleDelete(seed.id)}
                            className="px-2.5 py-1 rounded text-xs border border-border text-muted hover:border-red/40 hover:text-red hover:bg-red/5 transition-all">
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {/* ════════════════ QUEUE TAB ════════════════ */}
        {!loading && tab === 'queue' && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard label="Pending"   value={ov?.queue_pending ?? 0} color="text-yellow" sub="waiting to crawl" />
              <StatCard label="Completed" value={ov?.queue_done    ?? 0} color="text-green"  sub="indexed" />
              <StatCard label="Total"     value={ov?.queue_total   ?? 0} color="text-content" sub="in queue" />
            </div>

            <section className="bg-card border border-border rounded-xl p-5">
              <h2 className="text-sm font-semibold text-content mb-1">Add URL to Crawl Queue</h2>
              <p className="text-xs text-muted mb-4">
                Force-index a specific URL at <span className="font-bold text-red">Priority 0</span> — absolute front of the queue.
                Also removes the URL from the Redis visited cache so it is always re-fetched, even if previously crawled.
                Unlike seeds, this is a one-time crawl — the URL is not re-crawled automatically.
              </p>
              <form onSubmit={handleAddQueue} className="flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[200px]">
                  <label className="text-xs text-muted block mb-1">URL to crawl</label>
                  <input value={qUrl} onChange={e => setQUrl(e.target.value)}
                    placeholder="https://example.com/specific-page"
                    className="w-full bg-primary border border-border rounded-lg px-3 py-2 text-sm text-content placeholder:text-muted focus:outline-none focus:border-blue" />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Content type</label>
                  <select value={qType} onChange={e => setQType(e.target.value)}
                    className="bg-primary border border-border rounded-lg px-3 py-2 text-sm text-content focus:outline-none focus:border-blue">
                    {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-2 bg-red/5 border border-red/20 rounded-lg">
                  <span className="w-2 h-2 rounded-full bg-red animate-pulse" />
                  <span className="text-xs text-red font-bold">Super Force P0</span>
                </div>
                <button type="submit" disabled={qLoading}
                  className="bg-blue text-white text-sm px-5 py-2 rounded-lg hover:bg-blue/80 disabled:opacity-50 font-medium transition-all flex items-center gap-2">
                  {qLoading ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
                  {qLoading ? 'Queuing…' : 'Queue URL'}
                </button>
                {qMsg && <p className={`w-full text-xs font-medium ${qMsg.includes('Failed') ? 'text-red' : 'text-green'}`}>{qMsg.includes('Failed') ? '✗' : '✓'} {qMsg}</p>}
              </form>
            </section>

            <section className="bg-card border border-border rounded-xl p-5">
              <h3 className="text-sm font-semibold text-content mb-4">Domain Progress</h3>
              <div className="space-y-4">
                {data?.queue_by_domain.map(q => {
                  const total = q.pending + q.done
                  const pct = total > 0 ? Math.round(q.done/total*100) : 0
                  return (
                    <GaugeBar key={q.domain} label={q.domain} pct={pct} color="bg-blue"
                      sublabel={`${fmt(q.done)} done · ${fmt(q.pending)} pending · ${fmt(total)} total`} />
                  )
                })}
              </div>
            </section>
          </>
        )}

        {/* ════════════════ SYSTEM TAB ════════════════ */}
        {tab === 'system' && (
          <>
            {sysLoading && !sys && (
              <div className="flex items-center justify-center py-24">
                <div className="flex gap-1.5">
                  {[0,1,2].map(i => (
                    <div key={i} className="w-2.5 h-2.5 rounded-full bg-blue animate-pulse-dot" style={{ animationDelay: `${i*0.15}s` }} />
                  ))}
                </div>
              </div>
            )}
            {sys && (
              <>
                {/* Key metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard label="DB Size"         value={sys.db_size_pretty}     color="text-blue"   />
                  <StatCard label="Pages / Hour"    value={sys.pages_per_hour}     color="text-green"  sub={`${fmt(sys.pages_per_day)}/day`} />
                  <StatCard label="API Uptime"      value={fmtUptime(sys.api_uptime_sec)} color="text-purple" />
                  <StatCard label="Redis Cache"     value={sys.redis_used_human}   color="text-yellow" sub={`${sys.redis_hit_rate}% hit rate`} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {/* Resource gauges */}
                  <section className="bg-card border border-border rounded-xl p-5 space-y-4">
                    <h3 className="text-sm font-semibold text-content flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                      System Resources
                    </h3>
                    <GaugeBar
                      label="Memory (RAM)"
                      pct={sys.mem_total_kb > 0 ? Math.round((1 - sys.mem_avail_kb/sys.mem_total_kb)*100) : 0}
                      color="bg-blue"
                      sublabel={`${fmtB((sys.mem_total_kb-sys.mem_avail_kb)*1024)} used of ${fmtB(sys.mem_total_kb*1024)}`}
                    />
                    <GaugeBar
                      label="Disk Storage"
                      pct={sys.disk_total_kb > 0 ? Math.round((1 - sys.disk_avail_kb/sys.disk_total_kb)*100) : 0}
                      color="bg-purple"
                      sublabel={`${fmtB((sys.disk_total_kb-sys.disk_avail_kb)*1024)} used · ${fmtB(sys.disk_avail_kb*1024)} free`}
                    />
                    <GaugeBar
                      label="Redis Memory"
                      pct={sys.redis_max_bytes > 0 ? Math.round(sys.redis_used_bytes/sys.redis_max_bytes*100) : 0}
                      color="bg-yellow"
                      sublabel={`${fmtB(sys.redis_used_bytes)} used${sys.redis_max_bytes > 0 ? ` of ${fmtB(sys.redis_max_bytes)}` : ''}`}
                    />
                    <GaugeBar
                      label="Queue Progress"
                      pct={sys.queue_progress_pct}
                      color="bg-green"
                      sublabel={`${sys.queue_progress_pct.toFixed(1)}% of crawl queue completed`}
                    />
                  </section>

                  {/* Performance */}
                  <section className="bg-card border border-border rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-content mb-4 flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                      Performance Metrics
                    </h3>
                    <div className="space-y-3">
                      {[
                        { label: 'Pages indexed / hour', value: fmt(sys.pages_per_hour), color: 'text-green', icon: '📄' },
                        { label: 'Pages indexed / day',  value: fmt(sys.pages_per_day),  color: 'text-blue',  icon: '📅' },
                        { label: 'Crawler events (5m)',  value: fmt(sys.crawler_events_5m), color: 'text-yellow', icon: '🕷️' },
                        { label: 'Redis cache hit rate', value: `${sys.redis_hit_rate}%`, color: 'text-purple', icon: '⚡' },
                        { label: 'API uptime',           value: fmtUptime(sys.api_uptime_sec), color: 'text-content', icon: '🟢' },
                        { label: 'System uptime',        value: fmtUptime(sys.sys_uptime_sec), color: 'text-muted', icon: '🖥️' },
                      ].map(m => (
                        <div key={m.label} className="flex items-center justify-between py-2 border-b border-border/50 last:border-none">
                          <span className="text-xs text-muted flex items-center gap-2">
                            <span>{m.icon}</span>{m.label}
                          </span>
                          <span className={`text-sm font-bold font-mono ${m.color}`}>{m.value}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>

                {/* DB table sizes */}
                <section className="bg-card border border-border rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-border">
                    <h3 className="text-sm font-semibold text-content">Database Tables — {sys.db_size_pretty} total</h3>
                  </div>
                  <div className="p-5 space-y-2.5">
                    {sys.tables.map(t => {
                      const maxBytes = sys.tables[0]?.bytes ?? 1
                      return (
                        <div key={t.name}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-content font-mono">{t.name}</span>
                            <span className="text-muted font-mono">{fmtB(t.bytes)}</span>
                          </div>
                          <div className="h-1.5 bg-hover rounded-full overflow-hidden">
                            <div className="h-full bg-blue/60 rounded-full" style={{ width: `${Math.round(t.bytes/maxBytes*100)}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>

                <p className="text-center text-xs text-muted/60">Auto-refreshes every 8 seconds</p>
              </>
            )}
          </>
        )}

        {/* ════════════════ SEARCHES TAB ════════════════ */}
        {!loading && tab === 'searches' && (
          <section className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-content">Top Search Queries</h3>
            </div>
            <div className="p-5 space-y-3">
              {data?.top_searches.map((s, i) => {
                const max = data.top_searches[0]?.count ?? 1
                return (
                  <div key={s.query} className="flex items-center gap-3 group">
                    <span className="text-muted text-xs font-mono w-5 text-right flex-shrink-0">{i+1}</span>
                    <div className="flex-1">
                      <div className="flex justify-between items-center text-xs mb-1">
                        <Link href={`/search?q=${encodeURIComponent(s.query)}&tab=all&page=1`}
                          className="text-content font-khmer hover:text-blue transition-colors truncate">
                          {s.query}
                        </Link>
                        <span className="text-muted ml-2 flex-shrink-0 font-mono font-bold">{fmt(s.count)}</span>
                      </div>
                      <div className="h-1.5 bg-hover rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-blue to-purple rounded-full transition-all" style={{ width: `${Math.round(s.count/max*100)}%` }} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

      </main>
    </div>
  )
}
