'use client'
import { useSearchParams, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'
import Sidebar from '@/components/layout/Sidebar'
import SearchResults from '@/components/search/SearchResults'
import type { TabId, SearchResult } from '@/types'

export default function SearchPage() {
  const params = useSearchParams()
  const router = useRouter()
  const query  = params.get('q')    ?? ''
  const tab    = (params.get('tab') ?? 'all') as TabId
  const page   = Number(params.get('page') ?? '1')

  // Redirect github tab to the feed page
  useEffect(() => {
    if (tab === 'github') router.replace('/feed')
  }, [tab, router])
  const [lang, setLang]             = useState(params.get('lang') ?? '')
  const [panelResult, setPanelResult] = useState<SearchResult | null>(null)

  useEffect(() => {
    setLang(params.get('lang') ?? '')
    setPanelResult(null) // reset panel on new search
  }, [params])

  return (
    <div className="flex flex-col min-h-screen bg-primary">
      <Header query={query} tab={tab} lang={lang} onLang={setLang} />

      <div className="flex-1 flex justify-center">
        <div className="w-full max-w-5xl px-4 py-5 flex gap-6">
          <main className="flex-1 min-w-0">
            <SearchResults
              query={query}
              tab={tab}
              page={page}
              lang={lang}
              onResults={results => setPanelResult(results[0] ?? null)}
            />
          </main>

          {tab === 'all' && <Sidebar result={panelResult} />}
        </div>
      </div>

      <Footer />
    </div>
  )
}
