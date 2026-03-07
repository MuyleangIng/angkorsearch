'use client'
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import SearchBox from '@/components/search/SearchBox'
import SearchTabs from '@/components/search/SearchTabs'
import ThemeToggle from '@/components/ui/ThemeToggle'
import { useAuth } from '@/lib/AuthContext'
import type { TabId } from '@/types'

interface Props {
  query:    string
  tab:      TabId
  lang:     string
  onLang:   (l: string) => void
}

export default function Header({ query, tab, lang, onLang }: Props) {
  const router = useRouter()
  const { user, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function handleLogout() {
    setMenuOpen(false)
    await logout()
    router.push('/')
  }

  return (
    <header className="sticky top-0 z-40 bg-card border-b border-border">
      <div className="flex items-center gap-4 px-4 pt-3 pb-1">
        {/* Logo */}
        <button
          onClick={() => router.push('/')}
          className="flex-shrink-0 hover:opacity-80 transition-opacity"
          aria-label="Go home"
        >
          <img src="/logo.png" alt="AngkorSearch" className="h-9 w-auto" />
        </button>

        {/* Compact search */}
        <div className="flex-1 max-w-2xl">
          <SearchBox
            initialValue={query}
            currentTab={tab}
            compact
          />
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
          {/* Lang select */}
          <select
            value={lang}
            onChange={e => onLang(e.target.value)}
            className="hidden sm:block bg-card2 border border-border text-muted text-xs rounded-full px-3 py-1.5 focus:outline-none focus:border-blue"
          >
            <option value="">All</option>
            <option value="km">🇰🇭 ខ្មែរ</option>
            <option value="en">🇬🇧 English</option>
          </select>

          <ThemeToggle />

          {/* Feed link */}
          <Link href="/feed" className="hidden md:inline-flex items-center gap-1.5 text-xs text-muted hover:text-content transition-colors px-2 py-1.5 rounded-full hover:bg-hover">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
            </svg>
            Feed
          </Link>

          {/* Bookmarks link */}
          <Link href="/profile?tab=bookmarks" className="hidden md:inline-flex items-center gap-1.5 text-xs text-muted hover:text-content transition-colors px-2 py-1.5 rounded-full hover:bg-hover">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z" />
            </svg>
            Bookmarks
          </Link>

          {user ? (
            /* ── User avatar + dropdown ── */
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(v => !v)}
                className="flex items-center gap-2 rounded-full hover:bg-hover transition-colors px-1.5 py-1"
                aria-label="Account menu"
              >
                {user.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt={user.username}
                    className="w-7 h-7 rounded-full object-cover border border-border"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-blue/20 flex items-center justify-center text-blue text-xs font-bold border border-border">
                    {(user.username?.[0] ?? user.email[0]).toUpperCase()}
                  </div>
                )}
                <svg className="w-3 h-3 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full mt-2 w-52 bg-card border border-border rounded-xl shadow-lg py-1 z-50">
                  <div className="px-4 py-2 border-b border-border">
                    <p className="text-xs font-semibold text-content truncate">{user.username ?? 'User'}</p>
                    <p className="text-xs text-muted truncate">{user.email}</p>
                  </div>
                  {[
                    { href: '/profile',              label: 'Profile',   icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
                    { href: '/profile?tab=bookmarks',label: 'Bookmarks', icon: 'M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z' },
                    { href: '/feed',                  label: 'Dev Feed',  icon: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z' },
                    { href: '/profile?tab=settings',  label: 'Settings',  icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
                  ].map(item => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-content hover:bg-hover transition-colors"
                    >
                      <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                      </svg>
                      {item.label}
                    </Link>
                  ))}
                  {user.role === 'admin' && (
                    <Link
                      href="/admin"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-content hover:bg-hover transition-colors border-t border-border mt-1 pt-2"
                    >
                      <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      Admin Dashboard
                    </Link>
                  )}
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red hover:bg-hover transition-colors border-t border-border mt-1 pt-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* ── Sign in button ── */
            <Link
              href="/login"
              className="hidden sm:inline-flex text-xs font-medium text-white bg-blue hover:bg-blue/90 transition-colors px-3 py-1.5 rounded-full"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 mt-1">
        <SearchTabs current={tab} query={query} />
      </div>
    </header>
  )
}
