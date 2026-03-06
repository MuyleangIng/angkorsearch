'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { TABS } from '@/lib/constants'
import type { TabId } from '@/types'

interface Props {
  current: TabId
  query:   string
}

export default function SearchTabs({ current, query }: Props) {
  const router = useRouter()

  function go(tab: TabId) {
    router.push(`/search?q=${encodeURIComponent(query)}&tab=${tab}`)
  }

  return (
    <div className="flex items-center gap-0 overflow-x-auto scrollbar-hide border-b border-border">
      {TABS.map(t => (
        <button
          key={t.id}
          onClick={() => go(t.id)}
          className={`
            flex items-center gap-1.5 px-4 py-3 text-sm whitespace-nowrap border-b-2 transition-all
            ${current === t.id
              ? 'border-blue text-blue font-medium'
              : 'border-transparent text-muted hover:text-content'
            }
          `}
        >
          {t.id === 'all' && (
            <svg viewBox="0 0 24 24" width={14} height={14}>
              <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" fill={current === 'all' ? '#4285f4' : '#8b949e'} />
            </svg>
          )}
          {t.label}
        </button>
      ))}
    </div>
  )
}
