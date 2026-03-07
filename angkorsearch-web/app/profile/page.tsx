'use client'
import { useState, useRef, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  updateProfile, changePassword, uploadAvatar, deleteAvatar,
  deleteAccount, logoutAllDevices, getAuthError,
} from '@/lib/auth'
import { clearHistory } from '@/lib/api'
import { useAuth } from '@/lib/AuthContext'
import { getDomain, timeSince } from '@/lib/utils'
import { getBmList, setBmList, getBmFolders, setBmFolders, type BmEntry } from '@/components/ui/BookmarkButton'

// ─── Settings helpers ─────────────────────────────────────────────────────────
const LS_SETTINGS = 'angkor_settings'

interface Settings {
  language:       'all' | 'km' | 'en'
  resultsPerPage: 10 | 20 | 30
  safeSearch:     boolean
  saveHistory:    boolean
  autoSuggest:    boolean
}
const SETTING_DEFAULTS: Settings = {
  language: 'all', resultsPerPage: 10,
  safeSearch: false, saveHistory: true, autoSuggest: true,
}
function loadSettings(): Settings {
  if (typeof window === 'undefined') return SETTING_DEFAULTS
  try { return { ...SETTING_DEFAULTS, ...JSON.parse(localStorage.getItem(LS_SETTINGS) ?? '{}') } }
  catch { return SETTING_DEFAULTS }
}

// ─── Sidebar sections ─────────────────────────────────────────────────────────
type Section = 'profile' | 'bookmarks' | 'settings' | 'security'
const NAV: { id: Section; label: string; icon: string }[] = [
  { id: 'profile',   label: 'Profile',    icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
  { id: 'bookmarks', label: 'Bookmarks',  icon: 'M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z' },
  { id: 'settings',  label: 'Settings',   icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
  { id: 'security',  label: 'Security',   icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
]

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const router   = useRouter()
  const params   = useSearchParams()
  const { user, refresh, logout: ctxLogout } = useAuth()

  const [section, setSection] = useState<Section>((params.get('tab') as Section) ?? 'profile')

  useEffect(() => {
    if (user === null) router.push('/login')
  }, [user, router])

  if (!user) return null

  return (
    <div className="min-h-screen bg-primary flex">
      {/* ── Sidebar ── */}
      <aside className="w-56 flex-shrink-0 border-r border-border flex flex-col py-6 sticky top-0 h-screen overflow-y-auto">
        <div className="px-4 mb-6">
          <Link href="/" className="flex items-center gap-2 mb-5 hover:opacity-80 transition-opacity">
            <img src="/logo.png" alt="AngkorSearch" className="h-7 w-auto" />
          </Link>
          {/* Mini avatar */}
          <div className="flex items-center gap-3">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt={user.username} className="w-9 h-9 rounded-full object-cover border border-border flex-shrink-0" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-blue/20 flex items-center justify-center text-blue font-bold border border-border flex-shrink-0">
                {(user.username?.[0] ?? user.email[0]).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-content truncate">{user.username || 'User'}</p>
              <p className="text-xs text-muted truncate">{user.role}</p>
            </div>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5 px-2 flex-1">
          {NAV.map(n => (
            <button
              key={n.id}
              onClick={() => setSection(n.id)}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${
                section === n.id ? 'bg-blue/10 text-blue' : 'text-muted hover:text-content hover:bg-hover'
              }`}
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={n.icon} />
              </svg>
              {n.label}
            </button>
          ))}
        </nav>

        <div className="px-4 pt-4 border-t border-border">
          <button
            onClick={async () => { await ctxLogout(); router.push('/') }}
            className="flex items-center gap-2 text-xs text-red hover:bg-red/5 w-full px-3 py-2 rounded-xl transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Content ── */}
      <main className="flex-1 min-w-0 px-6 py-8 max-w-3xl">
        {section === 'profile'   && <ProfileSection   user={user} refresh={refresh} />}
        {section === 'bookmarks' && <BookmarksSection userId={user.id} />}
        {section === 'settings'  && <SettingsSection />}
        {section === 'security'  && <SecuritySection  user={user} refresh={refresh} logout={ctxLogout} router={router} />}
      </main>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE SECTION
// ═══════════════════════════════════════════════════════════════════════════════
function ProfileSection({ user, refresh }: { user: any; refresh: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [username, setUsername] = useState(user.username ?? '')
  const [bio,      setBio]      = useState(user.bio ?? '')
  const [website,  setWebsite]  = useState(user.website ?? '')
  const [location, setLocation] = useState(user.location ?? '')
  const [msg,      setMsg]      = useState<{type:'ok'|'err';text:string}|null>(null)
  const [saving,   setSaving]   = useState(false)
  const [avatarLoading, setAvatarLoading] = useState(false)

  useEffect(() => {
    setUsername(user.username ?? '')
    setBio(user.bio ?? '')
    setWebsite(user.website ?? '')
    setLocation(user.location ?? '')
  }, [user])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setMsg(null)
    try {
      await updateProfile({ username, bio, website, location })
      await refresh()
      setMsg({ type: 'ok', text: 'Profile saved!' })
    } catch (err) { setMsg({ type: 'err', text: getAuthError(err) }) }
    finally { setSaving(false) }
  }

  async function handleAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setAvatarLoading(true)
    try { await uploadAvatar(file); await refresh() }
    catch (err) { setMsg({ type: 'err', text: getAuthError(err) }) }
    finally { setAvatarLoading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function handleRemoveAvatar() {
    setAvatarLoading(true)
    try { await deleteAvatar(); await refresh() }
    catch (err) { setMsg({ type: 'err', text: getAuthError(err) }) }
    finally { setAvatarLoading(false) }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-content">Profile</h1>
        <p className="text-sm text-muted mt-0.5">Manage your public profile information</p>
      </div>

      {/* Avatar */}
      <div className="bg-card border border-border rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-content mb-4">Photo</h2>
        <div className="flex items-center gap-5">
          <div className="relative flex-shrink-0">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt={user.username} className="w-20 h-20 rounded-full object-cover border-2 border-border" />
            ) : (
              <div className="w-20 h-20 rounded-full bg-blue/20 flex items-center justify-center text-blue text-2xl font-bold border-2 border-border">
                {(user.username?.[0] ?? user.email[0]).toUpperCase()}
              </div>
            )}
            {avatarLoading && (
              <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <button onClick={() => fileRef.current?.click()} disabled={avatarLoading}
              className="px-4 py-2 bg-blue text-white text-sm font-medium rounded-xl hover:bg-blue/90 transition-colors disabled:opacity-60">
              Upload photo
            </button>
            {user.avatar_url && (
              <button onClick={handleRemoveAvatar} disabled={avatarLoading}
                className="px-4 py-2 bg-card2 border border-border text-muted text-sm rounded-xl hover:text-content transition-colors disabled:opacity-60">
                Remove
              </button>
            )}
            <p className="text-xs text-muted">JPEG, PNG, WebP · max 5 MB</p>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleAvatar} />
      </div>

      {/* Info form */}
      <div className="bg-card border border-border rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-content mb-4">Info</h2>
        <div className="flex items-center gap-2 mb-4 pb-4 border-b border-border">
          <span className="text-xs text-muted">{user.email}</span>
          {user.email_verified ? (
            <span className="text-[10px] bg-green-400/10 text-green-400 border border-green-400/30 rounded-full px-2 py-0.5">verified</span>
          ) : (
            <Link href="/verify-email" className="text-xs text-blue hover:underline">Verify email</Link>
          )}
        </div>
        {msg && (
          <div className={`mb-4 text-sm rounded-xl px-4 py-3 border ${msg.type==='ok' ? 'bg-green-400/10 border-green-400/30 text-green-400' : 'bg-red/10 border-red/30 text-red'}`}>
            {msg.text}
          </div>
        )}
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <Field label="Username">
            <input type="text" value={username} onChange={e=>setUsername(e.target.value)}
              placeholder="your_username" className={INPUT} />
          </Field>
          <Field label="Bio">
            <textarea value={bio} onChange={e=>setBio(e.target.value)} rows={3}
              placeholder="Tell people about yourself…" className={`${INPUT} resize-none`} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Website">
              <input type="url" value={website} onChange={e=>setWebsite(e.target.value)}
                placeholder="https://…" className={INPUT} />
            </Field>
            <Field label="Location">
              <input type="text" value={location} onChange={e=>setLocation(e.target.value)}
                placeholder="Phnom Penh, Cambodia" className={INPUT} />
            </Field>
          </div>
          <button type="submit" disabled={saving}
            className="w-full bg-blue text-white rounded-xl py-2.5 font-semibold text-sm hover:bg-blue/90 transition-colors disabled:opacity-60">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </form>
      </div>

      {/* Linked accounts */}
      <div className="bg-card border border-border rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-content mb-4">Linked Accounts</h2>
        <div className="flex flex-col gap-3">
          {[
            { key: 'has_google', label: 'Google', href: '/auth/google', icon: (
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            )},
            { key: 'has_github', label: 'GitHub', href: '/auth/github', icon: (
              <svg className="w-5 h-5 fill-current text-content" viewBox="0 0 24 24">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
              </svg>
            )},
          ].map(({ key, label, href, icon }) => (
            <div key={key} className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">{icon}<span className="text-sm text-content">{label}</span></div>
              {(user as any)[key] ? (
                <span className="text-xs bg-green-400/10 text-green-400 border border-green-400/30 rounded-full px-2 py-0.5">Connected</span>
              ) : (
                <a href={href} className="text-xs text-blue hover:underline">Connect</a>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// BOOKMARKS SECTION
// ═══════════════════════════════════════════════════════════════════════════════
function BookmarksSection({ userId }: { userId: number }) {
  const [bookmarks,    setBookmarks]    = useState<BmEntry[]>([])
  const [folders,      setFolders]      = useState<string[]>([])
  const [activeFolder, setActiveFolder] = useState('All')
  const [search,       setSearch]       = useState('')
  const [newFolder,    setNewFolder]    = useState('')
  const [addingFolder, setAddingFolder] = useState(false)
  const [moveTarget,   setMoveTarget]   = useState<BmEntry | null>(null)

  // Load from per-user localStorage
  useEffect(() => {
    setBookmarks(getBmList(userId))
    setFolders(getBmFolders())
  }, [userId])

  // Refresh when window regains focus (bookmark may have been added from search)
  useEffect(() => {
    function onFocus() {
      setBookmarks(getBmList(userId))
      setFolders(getBmFolders())
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [userId])

  function addFolder() {
    const name = newFolder.trim()
    if (!name || folders.includes(name)) return
    const next = [...folders, name]
    setFolders(next)
    setBmFolders(next)
    setNewFolder('')
    setAddingFolder(false)
  }

  function moveTo(bm: BmEntry, folder: string) {
    const next = bookmarks.map(b => b.url === bm.url ? { ...b, folder } : b)
    setBookmarks(next)
    setBmList(userId, next)
    setMoveTarget(null)
  }

  function deleteBookmark(bm: BmEntry) {
    const next = bookmarks.filter(b => b.url !== bm.url)
    setBookmarks(next)
    setBmList(userId, next)
  }

  const allFolders = ['All', ...folders]

  const filtered = useMemo(() => {
    let list = activeFolder === 'All' ? bookmarks : bookmarks.filter(b => b.folder === activeFolder)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(b => b.title?.toLowerCase().includes(q) || b.url.toLowerCase().includes(q))
    }
    return list
  }, [bookmarks, activeFolder, search])

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: bookmarks.length }
    bookmarks.forEach(b => { c[b.folder ?? 'Default'] = (c[b.folder ?? 'Default'] ?? 0) + 1 })
    return c
  }, [bookmarks])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-content">Bookmarks</h1>
        <p className="text-sm text-muted mt-0.5">{bookmarks.length} saved items</p>
      </div>

      <div className="flex gap-5">
        {/* Folder sidebar */}
        <div className="w-44 flex-shrink-0">
          <div className="bg-card border border-border rounded-2xl p-3 flex flex-col gap-0.5">
            {allFolders.map(f => (
              <button
                key={f}
                onClick={() => setActiveFolder(f)}
                className={`flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-colors text-left ${
                  activeFolder === f ? 'bg-blue/10 text-blue' : 'text-muted hover:text-content hover:bg-hover'
                }`}
              >
                <span className="truncate">{f}</span>
                <span className="text-xs opacity-60 ml-1 flex-shrink-0">{counts[f] ?? 0}</span>
              </button>
            ))}
            <div className="border-t border-border mt-1 pt-1">
              {addingFolder ? (
                <div className="flex gap-1 p-1">
                  <input autoFocus value={newFolder} onChange={e => setNewFolder(e.target.value)}
                    onKeyDown={e => { if (e.key==='Enter') addFolder(); if (e.key==='Escape') setAddingFolder(false) }}
                    placeholder="Name…"
                    className="flex-1 bg-card2 border border-border rounded-lg px-2 py-1 text-xs text-content focus:outline-none focus:border-blue" />
                  <button onClick={addFolder} className="px-2 py-1 bg-blue text-white text-xs rounded-lg">+</button>
                </div>
              ) : (
                <button onClick={() => setAddingFolder(true)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted hover:text-content w-full transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
                  </svg>
                  New folder
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Bookmark list */}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search bookmarks…"
              className="w-full bg-card border border-border rounded-xl pl-9 pr-4 py-2 text-sm text-content focus:outline-none focus:border-blue transition-colors" />
          </div>

          {filtered.length === 0 && (
            <div className="text-center py-16 text-muted">
              <svg className="w-10 h-10 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z"/>
              </svg>
              <p className="text-sm font-medium">No bookmarks here</p>
              <p className="text-xs mt-1">Search and click the bookmark icon to save</p>
            </div>
          )}

          <div className="flex flex-col divide-y divide-border rounded-2xl border border-border overflow-hidden">
            {filtered.map(bm => (
                <div key={bm.url} className="group flex items-center gap-3 px-4 py-3 bg-card hover:bg-hover transition-colors">
                  <img src={`https://www.google.com/s2/favicons?sz=16&domain=${getDomain(bm.url)}`} alt=""
                    className="w-4 h-4 rounded-sm flex-shrink-0"
                    onError={e => (e.currentTarget.style.display='none')} />
                  <a href={bm.url} target="_blank" rel="noreferrer"
                    className="flex-1 min-w-0 text-sm text-content hover:text-blue transition-colors truncate">
                    {bm.title || bm.url}
                  </a>
                  {bm.folder && bm.folder !== 'Default' && (
                    <span className="hidden sm:block text-[10px] px-1.5 py-0.5 bg-card2 border border-border text-muted rounded-full flex-shrink-0">
                      {bm.folder}
                    </span>
                  )}
                  <span className="hidden md:block text-xs text-muted flex-shrink-0">{timeSince(bm.saved_at)}</span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button onClick={() => setMoveTarget(bm)} title="Move to folder"
                      className="p-1.5 text-muted hover:text-content rounded-lg hover:bg-card2 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
                      </svg>
                    </button>
                    <button onClick={() => deleteBookmark(bm)}
                      className="p-1.5 text-muted hover:text-red rounded-lg hover:bg-red/10 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                      </svg>
                    </button>
                  </div>
                </div>
            ))}
          </div>
        </div>
      </div>

      {/* Move modal */}
      {moveTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setMoveTarget(null)}>
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-xs shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-content mb-1">Move to folder</h3>
            <p className="text-xs text-muted mb-3 truncate">{moveTarget.title || moveTarget.url}</p>
            <div className="flex flex-col gap-1">
              {['Default', ...folders.filter(f => f !== 'Default')].map(f => (
                <button key={f} onClick={() => moveTo(moveTarget, f)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-left transition-colors ${
                    (moveTarget.folder ?? 'Default') === f ? 'bg-blue/10 text-blue' : 'text-content hover:bg-hover'
                  }`}>
                  <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
                  </svg>
                  {f}
                  {(moveTarget.folder ?? 'Default') === f && <span className="ml-auto text-blue text-xs">✓</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS SECTION
// ═══════════════════════════════════════════════════════════════════════════════
function SettingsSection() {
  const [s, setS] = useState<Settings>(SETTING_DEFAULTS)
  const [saved, setSaved] = useState(false)
  const [clearing, setClearing] = useState<string | null>(null)
  const [clearMsg, setClearMsg] = useState<string | null>(null)

  useEffect(() => { setS(loadSettings()) }, [])

  function upd<K extends keyof Settings>(key: K, val: Settings[K]) {
    setS(prev => { const next = {...prev, [key]: val}; localStorage.setItem(LS_SETTINGS, JSON.stringify(next)); return next })
    setSaved(true); setTimeout(() => setSaved(false), 1500)
  }

  async function doClear(period: string) {
    setClearing(period)
    try {
      await clearHistory()
      const labels: Record<string,string> = { day:'today', week:'this week', month:'this month', all:'all time' }
      setClearMsg(`Cleared history for ${labels[period]}`)
      setTimeout(() => setClearMsg(null), 3000)
    } catch { setClearMsg('Failed') } finally { setClearing(null) }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-content">Settings</h1>
          <p className="text-sm text-muted mt-0.5">Search preferences and privacy</p>
        </div>
        {saved && <span className="text-xs text-green-400">Saved</span>}
      </div>

      {/* Search prefs */}
      <div className="bg-card border border-border rounded-2xl p-6 space-y-5">
        <h2 className="text-sm font-semibold text-content">Search</h2>

        <div>
          <p className="text-sm font-medium text-content mb-2">Default Language</p>
          <div className="flex gap-2 flex-wrap">
            {([['all','All'],['km','🇰🇭 Khmer'],['en','🇬🇧 English']] as const).map(([val, label]) => (
              <button key={val} onClick={() => upd('language', val)}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${s.language===val ? 'bg-blue text-white border-blue' : 'bg-card2 border-border text-muted hover:text-content'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-content mb-2">Results Per Page</p>
          <div className="flex gap-2">
            {([10,20,30] as const).map(n => (
              <button key={n} onClick={() => upd('resultsPerPage', n)}
                className={`w-14 py-2 rounded-xl text-sm font-medium border transition-colors ${s.resultsPerPage===n ? 'bg-blue text-white border-blue' : 'bg-card2 border-border text-muted hover:text-content'}`}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <Toggle label="Search Suggestions" desc="Show autocomplete as you type" val={s.autoSuggest} onChange={v => upd('autoSuggest', v)} />
        <Toggle label="Safe Search" desc="Filter explicit content" val={s.safeSearch} onChange={v => upd('safeSearch', v)} />
      </div>

      {/* History & Privacy */}
      <div className="bg-card border border-border rounded-2xl p-6 space-y-5">
        <h2 className="text-sm font-semibold text-content">History &amp; Privacy</h2>
        <Toggle label="Save Search History" desc="Remember your queries for better suggestions" val={s.saveHistory} onChange={v => upd('saveHistory', v)} />

        <div>
          <p className="text-sm font-medium text-content mb-1">Clear Search History</p>
          <p className="text-xs text-muted mb-3">Remove saved queries by time period</p>
          {clearMsg && (
            <div className="mb-3 text-sm text-green-400 bg-green-400/10 border border-green-400/20 rounded-xl px-3 py-2">{clearMsg}</div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[['day','Today'],['week','This Week'],['month','This Month'],['all','All Time']].map(([p, label]) => (
              <button key={p} onClick={() => doClear(p)} disabled={!!clearing}
                className="py-2 px-3 bg-card2 border border-border text-muted text-xs rounded-xl hover:border-red/40 hover:text-red transition-colors disabled:opacity-50">
                {clearing===p ? 'Clearing…' : label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECURITY SECTION
// ═══════════════════════════════════════════════════════════════════════════════
function SecuritySection({ user, refresh, logout, router }: any) {
  const [cur, setCur] = useState(''); const [np, setNp] = useState(''); const [np2, setNp2] = useState('')
  const [passMsg, setPassMsg] = useState<{type:'ok'|'err';text:string}|null>(null)
  const [passSaving, setPassSaving] = useState(false)
  const [deletePass, setDeletePass] = useState('')
  const [deleteMsg, setDeleteMsg] = useState<{type:'ok'|'err';text:string}|null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [logoutAllLoading, setLogoutAllLoading] = useState(false)

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault(); setPassMsg(null)
    if (np.length < 8) { setPassMsg({type:'err',text:'Minimum 8 characters'}); return }
    if (np !== np2)    { setPassMsg({type:'err',text:'Passwords do not match'}); return }
    setPassSaving(true)
    try { await changePassword(cur, np); setPassMsg({type:'ok',text:'Password changed!'}); setCur(''); setNp(''); setNp2('') }
    catch (err) { setPassMsg({type:'err',text:getAuthError(err)}) }
    finally { setPassSaving(false) }
  }

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault()
    if (!confirm('Delete your account? This cannot be undone.')) return
    setDeleteLoading(true)
    try { await deleteAccount(deletePass || undefined); logout(); router.push('/') }
    catch (err) { setDeleteMsg({type:'err',text:getAuthError(err)}); setDeleteLoading(false) }
  }

  async function handleLogoutAll() {
    setLogoutAllLoading(true)
    try { await logoutAllDevices(); logout(); router.push('/login') }
    catch { setLogoutAllLoading(false) }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-content">Security</h1>
        <p className="text-sm text-muted mt-0.5">Password and account access</p>
      </div>

      {/* Change password */}
      <div className="bg-card border border-border rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-content mb-4">Change Password</h2>
        {passMsg && (
          <div className={`mb-4 text-sm rounded-xl px-4 py-3 border ${passMsg.type==='ok' ? 'bg-green-400/10 border-green-400/30 text-green-400' : 'bg-red/10 border-red/30 text-red'}`}>
            {passMsg.text}
          </div>
        )}
        <form onSubmit={handlePassword} className="flex flex-col gap-4">
          {[['Current Password',cur,setCur],['New Password',np,setNp],['Confirm New Password',np2,setNp2]].map(([label, val, set]) => (
            <Field key={label as string} label={label as string}>
              <input type="password" value={val as string} onChange={e => (set as any)(e.target.value)}
                placeholder="••••••••" required className={INPUT} />
            </Field>
          ))}
          <button type="submit" disabled={passSaving}
            className="w-full bg-blue text-white rounded-xl py-2.5 font-semibold text-sm hover:bg-blue/90 transition-colors disabled:opacity-60">
            {passSaving ? 'Saving…' : 'Change Password'}
          </button>
        </form>
      </div>

      {/* Danger zone */}
      <div className="bg-card border border-red/30 rounded-2xl p-6 space-y-5">
        <h2 className="text-sm font-semibold text-red">Danger Zone</h2>

        <div className="flex items-center justify-between py-3 border-b border-border">
          <div>
            <p className="text-sm font-medium text-content">Sign out everywhere</p>
            <p className="text-xs text-muted">Revoke all active sessions on all devices</p>
          </div>
          <button onClick={handleLogoutAll} disabled={logoutAllLoading}
            className="px-4 py-2 bg-card2 border border-border text-sm text-muted rounded-xl hover:text-content transition-colors disabled:opacity-60">
            {logoutAllLoading ? 'Signing out…' : 'Sign out all'}
          </button>
        </div>

        <div>
          <p className="text-sm font-medium text-content mb-1">Delete Account</p>
          <p className="text-xs text-muted mb-4">Permanently delete your account and all data.</p>
          {deleteMsg && (
            <div className="mb-3 bg-red/10 border border-red/30 text-red text-sm rounded-xl px-4 py-3">{deleteMsg.text}</div>
          )}
          <form onSubmit={handleDelete} className="flex flex-col gap-3">
            {!user.has_google && !user.has_github && (
              <input type="password" value={deletePass} onChange={e => setDeletePass(e.target.value)}
                placeholder="Confirm your password" required className={`${INPUT} border-red/30 focus:border-red`} />
            )}
            <button type="submit" disabled={deleteLoading}
              className="w-full bg-red text-white rounded-xl py-2.5 font-semibold text-sm hover:bg-red/90 transition-colors disabled:opacity-60">
              {deleteLoading ? 'Deleting…' : 'Delete my account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

// ─── Shared helpers ────────────────────────────────────────────────────────────
const INPUT = 'w-full bg-card2 border border-border rounded-xl px-4 py-2.5 text-content text-sm focus:outline-none focus:border-blue transition-colors'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function Toggle({ label, desc, val, onChange }: { label:string; desc:string; val:boolean; onChange:(v:boolean)=>void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-content">{label}</p>
        <p className="text-xs text-muted mt-0.5">{desc}</p>
      </div>
      <button onClick={() => onChange(!val)}
        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${val ? 'bg-blue' : 'bg-border'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${val ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  )
}
