'use client'
import { useSearchParams } from 'next/navigation'
import { useState, useEffect } from 'react'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'
import Sidebar from '@/components/layout/Sidebar'
import SearchResults from '@/components/search/SearchResults'
import { useSearch } from '@/hooks/useSearch'
import type { TabId } from '@/types'

export default function SearchPage() {
  const params      = useSearchParams()
  const query       = params.get('q')    ?? ''
  const tab         = (params.get('tab') ?? 'all') as TabId
  const page        = Number(params.get('page') ?? '1')
  const [lang, setLang] = useState(params.get('lang') ?? '')

  const { results } = useSearch()

  // Sync lang from URL on mount
  useEffect(() => {
    const l = params.get('lang') ?? ''
    setLang(l)
  }, [params])

  // Pick first result for knowledge panel
  const panelResult = results?.[0] ?? null

  return (
    <div className="flex flex-col min-h-screen bg-primary">
      <Header query={query} tab={tab} lang={lang} onLang={setLang} />

      <div className="flex-1 flex justify-center">
        <div className="w-full max-w-5xl px-4 py-5 flex gap-6">
          {/* Main results */}
          <main className="flex-1 min-w-0">
            <SearchResults query={query} tab={tab} page={page} lang={lang} />
          </main>

          {/* Knowledge panel sidebar */}
          <Sidebar result={panelResult} />
        </div>
      </div>

      <Footer />
    </div>
  )
}
