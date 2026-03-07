'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/AuthContext'

// ── Per-user localStorage helpers ─────────────────────────────────────────────
const LS_BM       = (uid: number) => `angkor_bm_u${uid}`
const LS_FOLDERS  = 'angkor_bookmark_folders'
const DFLT_FOLDERS = ['Default', 'Reading List', 'Dev & Tech', 'News', 'Cambodia']

export interface BmEntry { url: string; title: string; folder: string; saved_at: string }

export function getBmList(uid: number): BmEntry[] {
  try { return JSON.parse(localStorage.getItem(LS_BM(uid)) ?? '[]') } catch { return [] }
}
export function setBmList(uid: number, list: BmEntry[]) {
  try { localStorage.setItem(LS_BM(uid), JSON.stringify(list)) } catch { /* ignore */ }
}
export function getBmFolders(): string[] {
  try {
    const f = JSON.parse(localStorage.getItem(LS_FOLDERS) ?? 'null')
    return Array.isArray(f) && f.length > 0 ? f : DFLT_FOLDERS
  } catch { return DFLT_FOLDERS }
}
export function setBmFolders(f: string[]) {
  try { localStorage.setItem(LS_FOLDERS, JSON.stringify(f)) } catch { /* ignore */ }
}
export function isBookmarked(uid: number, url: string): boolean {
  return getBmList(uid).some(b => b.url === url)
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  url:     string
  title:   string
  size?:   'sm' | 'md'
  className?: string
}

export default function BookmarkButton({ url, title, size = 'sm', className = '' }: Props) {
  const { user, loading } = useAuth()
  const router            = useRouter()
  const popupRef          = useRef<HTMLDivElement>(null)

  const [saved,        setSaved]        = useState(false)
  const [open,         setOpen]         = useState(false)
  const [folders,      setFolders]      = useState<string[]>(DFLT_FOLDERS)
  const [folder,       setFolder]       = useState('Default')
  const [toast,        setToast]        = useState('')
  const [addingFolder, setAddingFolder] = useState(false)
  const [newFolder,    setNewFolder]    = useState('')

  // Read bookmark state from localStorage once user is known
  useEffect(() => {
    if (!user) return
    const list = getBmList(user.id)
    const existing = list.find(b => b.url === url)
    setSaved(!!existing)
    if (existing) setFolder(existing.folder)
    setFolders(getBmFolders())
  }, [user, url])

  // Close popup on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setOpen(false)
        setAddingFolder(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2200)
  }

  function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (loading) return
    if (!user) {
      // Redirect to login, then back
      router.push('/login?next=' + encodeURIComponent(window.location.pathname + window.location.search))
      return
    }
    if (saved) {
      // Remove bookmark
      const list = getBmList(user.id).filter(b => b.url !== url)
      setBmList(user.id, list)
      setSaved(false)
      showToast('Removed from bookmarks')
    } else {
      setOpen(v => !v)
    }
  }

  function handleSave() {
    if (!user) return
    const list = getBmList(user.id).filter(b => b.url !== url)
    list.unshift({ url, title, folder, saved_at: new Date().toISOString() })
    setBmList(user.id, list)
    setSaved(true)
    setOpen(false)
    setAddingFolder(false)
    showToast(`Saved to "${folder}"`)
  }

  function handleAddFolder() {
    const name = newFolder.trim()
    if (!name || folders.includes(name)) { setAddingFolder(false); return }
    const next = [...folders, name]
    setFolders(next)
    setBmFolders(next)
    setFolder(name)
    setNewFolder('')
    setAddingFolder(false)
  }

  const iconSize = size === 'sm' ? 15 : 18

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={handleClick}
        title={saved ? 'Remove bookmark' : 'Save bookmark'}
        className={`
          flex items-center justify-center rounded-lg transition-all
          ${size === 'sm' ? 'p-1.5' : 'p-2'}
          ${saved
            ? 'text-blue bg-blue/10 hover:bg-blue/20'
            : 'text-muted hover:text-content hover:bg-hover'}
        `}
      >
        {saved ? (
          // Filled bookmark
          <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} fill="currentColor">
            <path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/>
          </svg>
        ) : (
          // Outline bookmark
          <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2v16z" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>

      {/* Toast notification */}
      {toast && (
        <div className="absolute bottom-full right-0 mb-2 bg-card border border-border rounded-xl px-3 py-2 text-xs text-content shadow-xl whitespace-nowrap z-[60] pointer-events-none">
          {toast.startsWith('Saved') ? (
            <span className="text-green font-medium">{toast}</span>
          ) : (
            <span className="text-muted">{toast}</span>
          )}
        </div>
      )}

      {/* Save popup */}
      {open && user && (
        <div
          ref={popupRef}
          className="absolute right-0 top-full mt-1 bg-card border border-border rounded-2xl shadow-2xl shadow-black/40 z-[60] w-56 overflow-hidden"
        >
          <div className="px-4 pt-3 pb-2 border-b border-border">
            <p className="text-xs font-bold text-content">Save to bookmarks</p>
            <p className="text-[10px] text-muted mt-0.5 truncate">{title || url}</p>
          </div>

          {/* Folder list */}
          <div className="p-2 max-h-44 overflow-y-auto space-y-0.5">
            {folders.map(f => (
              <button
                key={f}
                onClick={() => setFolder(f)}
                className={`
                  flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm text-left transition-colors
                  ${folder === f ? 'bg-blue/10 text-blue' : 'text-content hover:bg-hover'}
                `}
              >
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
                </svg>
                <span className="truncate flex-1">{f}</span>
                {folder === f && (
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
                  </svg>
                )}
              </button>
            ))}

            {/* New folder */}
            {addingFolder ? (
              <div className="flex gap-1 px-1 py-1">
                <input
                  autoFocus
                  value={newFolder}
                  onChange={e => setNewFolder(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleAddFolder()
                    if (e.key === 'Escape') { setAddingFolder(false); setNewFolder('') }
                  }}
                  placeholder="Folder name…"
                  className="flex-1 bg-primary border border-blue rounded-lg px-2 py-1.5 text-xs text-content focus:outline-none"
                />
                <button onClick={handleAddFolder} className="px-2 py-1 bg-blue text-white text-xs rounded-lg hover:bg-blue/90">
                  +
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAddingFolder(true)}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-xs text-muted hover:text-content hover:bg-hover transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
                </svg>
                New folder
              </button>
            )}
          </div>

          {/* Save button */}
          <div className="p-3 border-t border-border">
            <button
              onClick={handleSave}
              className="w-full bg-blue text-white rounded-xl py-2 text-sm font-semibold hover:bg-blue/90 transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
