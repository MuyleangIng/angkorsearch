'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import SearchBox from '@/components/search/SearchBox'
import SearchTabs from '@/components/search/SearchTabs'
import ThemeToggle from '@/components/ui/ThemeToggle'
import type { TabId } from '@/types'

interface Props {
  query:    string
  tab:      TabId
  lang:     string
  onLang:   (l: string) => void
}

export default function Header({ query, tab, lang, onLang }: Props) {
  const router = useRouter()

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

        {/* Admin link */}
        <div className="hidden md:flex items-center gap-2 ml-auto flex-shrink-0">
          <select
            value={lang}
            onChange={e => onLang(e.target.value)}
            className="bg-card2 border border-border text-muted text-xs rounded-full px-3 py-1.5 focus:outline-none focus:border-blue"
          >
            <option value="">All</option>
            <option value="km">🇰🇭 ខ្មែរ</option>
            <option value="en">🇬🇧 English</option>
          </select>
          <ThemeToggle />
          <Link href="/admin" className="text-xs text-muted hover:text-content transition-colors px-3 py-1.5 rounded-full hover:bg-hover">
            Admin
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 mt-1">
        <SearchTabs current={tab} query={query} />
      </div>
    </header>
  )
}
