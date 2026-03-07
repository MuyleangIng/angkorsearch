'use client'
import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import SearchBox from '@/components/search/SearchBox'
import StatsBar from '@/components/widgets/StatsBar'
import DiscoverFeed from '@/components/widgets/DiscoverFeed'
import ThemeToggle from '@/components/ui/ThemeToggle'
import { useAuth } from '@/lib/AuthContext'
import { QUICK_SEARCHES } from '@/lib/constants'

export default function HomePage() {
  const router = useRouter()
  const params = useSearchParams()
  const { user, refresh } = useAuth()
  const [mounted, setMounted] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)

  useEffect(() => { setMounted(true) }, [])

  // handle OAuth/register redirect params
  useEffect(() => {
    const registered = params.get('registered')
    const loginSuccess = params.get('login')
    if (registered === 'true') {
      setBanner('Account created! Welcome to AngkorSearch.')
      refresh()
    } else if (loginSuccess === 'success') {
      setBanner('Signed in successfully!')
      refresh()
    }
  }, [params, refresh])

  function handleSearch(q: string) {
    if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}&tab=all&page=1`)
  }

  return (
    <main className="flex flex-col min-h-screen bg-primary">
      {/* Banner */}
      {banner && (
        <div className="bg-blue/10 border-b border-blue/20 text-blue text-sm text-center py-2 px-4">
          {banner}
          <button onClick={() => setBanner(null)} className="ml-3 text-blue/60 hover:text-blue text-xs">✕</button>
        </div>
      )}

      {/* Hero */}
      <section className="flex flex-col items-center justify-center flex-1 px-4 pt-20 pb-10">
        {/* Logo */}
        <div className={`transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <img
            src="/logo.png"
            alt="AngkorSearch"
            className="h-24 w-auto mb-8 select-none"
            draggable={false}
          />
        </div>

        {/* Search box */}
        <div className={`w-full max-w-2xl transition-all duration-700 delay-100 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <SearchBox onSearch={handleSearch} />
        </div>

        {/* Quick search chips */}
        <div className={`flex flex-wrap justify-center gap-2 mt-6 transition-all duration-700 delay-200 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
          {QUICK_SEARCHES.map(chip => (
            <button
              key={chip}
              onClick={() => handleSearch(chip)}
              className="px-3 py-1.5 rounded-full bg-card border border-border text-muted text-xs hover:text-content hover:border-blue/40 transition-all hover:bg-card2 font-khmer"
            >
              {chip}
            </button>
          ))}
        </div>

        {/* Stats bar */}
        <div className={`mt-8 transition-all duration-700 delay-300 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
          <StatsBar />
        </div>
      </section>

      {/* Discover feed */}
      <section className="px-4 pb-10 max-w-5xl mx-auto w-full">
        <div className={`transition-all duration-700 delay-400 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          <h2 className="text-muted text-xs font-semibold uppercase tracking-wider mb-4">Discover</h2>
          <DiscoverFeed />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-4 mt-auto">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted">
          <span className="flex flex-wrap items-center justify-center sm:justify-start gap-1">
            Cambodia&apos;s open search engine · Made with <span className="text-red">♥</span> by
            <a href="https://muyleanging.com" target="_blank" rel="noreferrer" className="text-blue hover:underline ml-0.5">Ing Muyleang</a>
            <span className="mx-1 text-border">|</span>
            <a href="https://khmerstack.muyleanging.com" target="_blank" rel="noreferrer" className="text-blue hover:underline">KhmerStack</a>
          </span>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <Link href="/feed" className="hover:text-content transition-colors">Dev Feed</Link>
            <Link href="/bookmarks" className="hover:text-content transition-colors">Bookmarks</Link>
            <Link href="/settings" className="hover:text-content transition-colors">Settings</Link>
            <a href="/about" className="hover:text-content transition-colors">About</a>
            {user?.role === 'admin' && (
              <a href="/admin" className="hover:text-content transition-colors">Admin</a>
            )}
            {user ? (
              <Link href="/profile" className="flex items-center gap-1.5 hover:text-content transition-colors">
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt={user.username} className="w-5 h-5 rounded-full object-cover" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-blue/20 flex items-center justify-center text-blue text-[10px] font-bold">
                    {(user.username?.[0] ?? user.email[0]).toUpperCase()}
                  </div>
                )}
                {user.username ?? 'Profile'}
              </Link>
            ) : (
              <Link href="/login" className="text-blue hover:underline">Sign in</Link>
            )}
          </div>
        </div>
      </footer>
    </main>
  )
}
