'use client'
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { fetchBookmarks, saveBookmark } from '@/lib/api'
import { getDomain, timeSince } from '@/lib/utils'
import type { Bookmark } from '@/types'

// Stored in localStorage (folder management is client-side since the API only stores folder name)
const LS_FOLDERS = 'angkor_bookmark_folders'
const DEFAULT_FOLDERS = ['All', 'Reading List', 'Dev & Tech', 'News', 'Cambodia']

export default function BookmarksPage() {
  const [bookmarks,    setBookmarks]    = useState<Bookmark[]>([])
  const [loading,      setLoading]      = useState(true)
  const [folders,      setFolders]      = useState<string[]>(DEFAULT_FOLDERS)
  const [activeFolder, setActiveFolder] = useState('All')
  const [search,       setSearch]       = useState('')
  const [newFolder,    setNewFolder]    = useState('')
  const [addingFolder, setAddingFolder] = useState(false)
  const [moveTarget,   setMoveTarget]   = useState<Bookmark | null>(null)
  const [view,         setView]         = useState<'grid' | 'list'>('grid')

  useEffect(() => {
    const saved = localStorage.getItem(LS_FOLDERS)
    if (saved) {
      try { setFolders(JSON.parse(saved)) } catch { /* ignore */ }
    }
    fetchBookmarks()
      .then(setBookmarks)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function saveFolders(f: string[]) {
    setFolders(f)
    localStorage.setItem(LS_FOLDERS, JSON.stringify(f))
  }

  function addFolder() {
    const name = newFolder.trim()
    if (!name || folders.includes(name)) return
    saveFolders([...folders, name])
    setNewFolder('')
    setAddingFolder(false)
  }

  function deleteFolder(name: string) {
    if (name === 'All') return
    saveFolders(folders.filter(f => f !== name))
    if (activeFolder === name) setActiveFolder('All')
  }

  function renameFolder(old: string, next: string) {
    if (!next.trim() || old === 'All') return
    saveFolders(folders.map(f => f === old ? next : f))
    if (activeFolder === old) setActiveFolder(next)
  }

  async function moveBookmark(bm: Bookmark, folder: string) {
    // Re-save with new folder name (API's POST /bookmark upserts by url+user_id)
    await saveBookmark(bm.url, bm.title)
    setBookmarks(prev => prev.map(b => b.url === bm.url ? { ...b, folder } : b))
    setMoveTarget(null)
  }

  const filtered = useMemo(() => {
    let list = bookmarks
    if (activeFolder !== 'All') list = list.filter(b => b.folder === activeFolder)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(b => b.title?.toLowerCase().includes(q) || b.url.toLowerCase().includes(q))
    }
    return list
  }, [bookmarks, activeFolder, search])

  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = { All: bookmarks.length }
    bookmarks.forEach(b => { counts[b.folder] = (counts[b.folder] ?? 0) + 1 })
    return counts
  }, [bookmarks])

  return (
    <div className="min-h-screen bg-primary flex">
      {/* ── Sidebar ── */}
      <aside className="w-60 flex-shrink-0 border-r border-border flex flex-col py-6 sticky top-0 h-screen overflow-y-auto">
        <div className="px-4 mb-6">
          <Link href="/" className="flex items-center gap-2 mb-5">
            <img src="/logo.png" alt="AngkorSearch" className="h-7 w-auto" />
          </Link>
          <h2 className="text-base font-bold text-content">Bookmarks</h2>
          <p className="text-xs text-muted mt-0.5">{bookmarks.length} saved</p>
        </div>

        {/* Folder list */}
        <nav className="flex flex-col gap-0.5 px-2 flex-1">
          {folders.map(folder => (
            <FolderItem
              key={folder}
              name={folder}
              count={folderCounts[folder] ?? 0}
              active={activeFolder === folder}
              onSelect={() => setActiveFolder(folder)}
              onDelete={folder !== 'All' ? () => deleteFolder(folder) : undefined}
              onRename={folder !== 'All' ? (next) => renameFolder(folder, next) : undefined}
            />
          ))}
        </nav>

        {/* Add folder */}
        <div className="px-4 pt-4 border-t border-border mt-2">
          {addingFolder ? (
            <div className="flex gap-1.5">
              <input
                autoFocus
                value={newFolder}
                onChange={e => setNewFolder(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addFolder(); if (e.key === 'Escape') setAddingFolder(false) }}
                placeholder="Folder name"
                className="flex-1 bg-card2 border border-border rounded-lg px-2.5 py-1.5 text-xs text-content focus:outline-none focus:border-blue"
              />
              <button onClick={addFolder} className="px-2 py-1.5 bg-blue text-white text-xs rounded-lg">Add</button>
            </div>
          ) : (
            <button
              onClick={() => setAddingFolder(true)}
              className="flex items-center gap-2 text-xs text-muted hover:text-content transition-colors w-full"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New folder
            </button>
          )}
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 min-w-0 px-6 py-6">
        {/* Top bar */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search bookmarks…"
              className="w-full bg-card border border-border rounded-xl pl-9 pr-4 py-2 text-sm text-content focus:outline-none focus:border-blue transition-colors"
            />
          </div>
          {/* View toggle */}
          <div className="flex items-center gap-1 bg-card border border-border rounded-xl p-1">
            <button
              onClick={() => setView('grid')}
              className={`p-1.5 rounded-lg transition-colors ${view === 'grid' ? 'bg-blue text-white' : 'text-muted hover:text-content'}`}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 3h7v7H3zm0 11h7v7H3zm11-11h7v7h-7zm0 11h7v7h-7z"/>
              </svg>
            </button>
            <button
              onClick={() => setView('list')}
              className={`p-1.5 rounded-lg transition-colors ${view === 'list' ? 'bg-blue text-white' : 'text-muted hover:text-content'}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Folder header */}
        <div className="mb-4">
          <h2 className="text-base font-bold text-content">{activeFolder}</h2>
          <p className="text-xs text-muted">{filtered.length} bookmark{filtered.length !== 1 ? 's' : ''}</p>
        </div>

        {/* Empty state */}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-20 text-muted">
            <svg className="w-12 h-12 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z" />
            </svg>
            <p className="font-medium">No bookmarks yet</p>
            <p className="text-sm mt-1">Search something and click the bookmark icon</p>
          </div>
        )}

        {/* Skeleton */}
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-2xl p-4 space-y-2 animate-pulse">
                <div className="h-3 bg-card2 rounded w-1/3" />
                <div className="h-4 bg-card2 rounded w-full" />
                <div className="h-3 bg-card2 rounded w-2/3" />
              </div>
            ))}
          </div>
        )}

        {/* Grid / List view */}
        {!loading && filtered.length > 0 && (
          view === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map(bm => (
                <BookmarkCard
                  key={bm.url}
                  bm={bm}
                  folders={folders.filter(f => f !== 'All')}
                  onMove={() => setMoveTarget(bm)}
                  onDelete={() => setBookmarks(prev => prev.filter(b => b.url !== bm.url))}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border rounded-2xl border border-border overflow-hidden">
              {filtered.map(bm => (
                <BookmarkRow
                  key={bm.url}
                  bm={bm}
                  onMove={() => setMoveTarget(bm)}
                  onDelete={() => setBookmarks(prev => prev.filter(b => b.url !== bm.url))}
                />
              ))}
            </div>
          )
        )}
      </main>

      {/* ── Move to folder modal ── */}
      {moveTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setMoveTarget(null)}>
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-content mb-1">Move to folder</h3>
            <p className="text-xs text-muted mb-4 truncate">{moveTarget.title || moveTarget.url}</p>
            <div className="flex flex-col gap-1">
              {folders.filter(f => f !== 'All').map(f => (
                <button
                  key={f}
                  onClick={() => moveBookmark(moveTarget, f)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-left transition-colors ${
                    moveTarget.folder === f ? 'bg-blue/10 text-blue' : 'text-content hover:bg-hover'
                  }`}
                >
                  <svg className="w-4 h-4 text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                  </svg>
                  {f}
                  {moveTarget.folder === f && <span className="ml-auto text-blue">✓</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function FolderItem({
  name, count, active, onSelect, onDelete, onRename,
}: {
  name: string; count: number; active: boolean
  onSelect: () => void
  onDelete?: () => void
  onRename?: (next: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(name)

  return (
    <div
      className={`group flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-colors ${
        active ? 'bg-blue/10 text-blue' : 'text-muted hover:text-content hover:bg-hover'
      }`}
      onClick={onSelect}
    >
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
      </svg>
      {editing ? (
        <input
          autoFocus
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { onRename?.(val); setEditing(false) }
            if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={() => setEditing(false)}
          className="flex-1 bg-transparent text-sm focus:outline-none"
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <span className="flex-1 text-sm truncate">{name}</span>
      )}
      <span className="text-xs opacity-60">{count}</span>
      {onRename && (
        <button
          onClick={e => { e.stopPropagation(); setEditing(true) }}
          className="opacity-0 group-hover:opacity-100 text-muted hover:text-content transition-opacity ml-0.5"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
      )}
      {onDelete && (
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="opacity-0 group-hover:opacity-100 text-muted hover:text-red transition-opacity"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}

function BookmarkCard({ bm, folders, onMove, onDelete }: {
  bm: Bookmark; folders: string[]
  onMove: () => void; onDelete: () => void
}) {
  const domain = getDomain(bm.url)
  return (
    <div className="group relative bg-card border border-border rounded-2xl p-4 hover:border-blue/30 hover:shadow-lg hover:shadow-black/20 transition-all flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <img
          src={`https://www.google.com/s2/favicons?sz=16&domain=${domain}`}
          alt=""
          className="w-4 h-4 rounded-sm flex-shrink-0"
          onError={e => (e.currentTarget.style.display = 'none')}
        />
        <span className="text-xs text-muted truncate flex-1">{domain}</span>
        {bm.folder && bm.folder !== 'Default' && (
          <span className="text-[10px] px-1.5 py-0.5 bg-blue/10 text-blue border border-blue/20 rounded-full flex-shrink-0">
            {bm.folder}
          </span>
        )}
      </div>
      <a
        href={bm.url}
        target="_blank"
        rel="noreferrer"
        className="text-content text-sm font-medium leading-snug hover:text-blue transition-colors line-clamp-2"
      >
        {bm.title || bm.url}
      </a>
      <p className="text-xs text-muted truncate">{bm.url}</p>
      <div className="flex items-center justify-between mt-auto pt-2 border-t border-border/50">
        <span className="text-xs text-muted">{timeSince(bm.saved_at)}</span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onMove} title="Move to folder" className="p-1.5 text-muted hover:text-content hover:bg-hover rounded-lg transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            </svg>
          </button>
          <button onClick={onDelete} title="Delete" className="p-1.5 text-muted hover:text-red hover:bg-red/10 rounded-lg transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

function BookmarkRow({ bm, onMove, onDelete }: {
  bm: Bookmark; onMove: () => void; onDelete: () => void
}) {
  const domain = getDomain(bm.url)
  return (
    <div className="group flex items-center gap-3 px-4 py-3 bg-card hover:bg-hover transition-colors">
      <img
        src={`https://www.google.com/s2/favicons?sz=16&domain=${domain}`}
        alt=""
        className="w-4 h-4 rounded-sm flex-shrink-0"
        onError={e => (e.currentTarget.style.display = 'none')}
      />
      <a
        href={bm.url}
        target="_blank"
        rel="noreferrer"
        className="flex-1 min-w-0 text-sm text-content hover:text-blue transition-colors truncate"
      >
        {bm.title || bm.url}
      </a>
      {bm.folder && bm.folder !== 'Default' && (
        <span className="text-[10px] px-1.5 py-0.5 bg-card2 border border-border text-muted rounded-full flex-shrink-0 hidden sm:block">
          {bm.folder}
        </span>
      )}
      <span className="text-xs text-muted flex-shrink-0 hidden md:block">{timeSince(bm.saved_at)}</span>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button onClick={onMove} className="p-1.5 text-muted hover:text-content rounded-lg transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          </svg>
        </button>
        <button onClick={onDelete} className="p-1.5 text-muted hover:text-red rounded-lg transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
