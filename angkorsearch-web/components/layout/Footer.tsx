'use client'
import Link from 'next/link'
import { useAuth } from '@/lib/AuthContext'

export default function Footer() {
  const { user } = useAuth()

  return (
    <footer className="border-t border-border py-5 mt-auto">
      <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted">
        <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4 text-center sm:text-left">
          <span>🇰🇭 AngkorSearch — Cambodia&apos;s open search engine</span>
          <span className="hidden sm:inline text-border">|</span>
          <span className="flex items-center gap-1">
            Made with <span className="text-red mx-0.5">♥</span> by{' '}
            <a href="https://muyleanging.com" target="_blank" rel="noreferrer" className="text-blue hover:underline ml-1">
              Ing Muyleang
            </a>
            <span className="mx-1.5 text-border">|</span>
            <a href="https://khmerstack.muyleanging.com" target="_blank" rel="noreferrer" className="text-blue hover:underline">
              KhmerStack
            </a>
          </span>
        </div>

        <div className="flex items-center gap-4">
          <Link href="/feed"  className="hover:text-content transition-colors">Feed</Link>
          <Link href="/about" className="hover:text-content transition-colors">About</Link>

          {user?.role === 'admin' && (
            <Link href="/admin" className="hover:text-content transition-colors">Admin</Link>
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
              {user.username || 'Profile'}
            </Link>
          ) : (
            <Link href="/login" className="text-blue hover:underline font-medium">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </footer>
  )
}
