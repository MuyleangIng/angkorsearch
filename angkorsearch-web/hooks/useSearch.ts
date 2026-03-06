'use client'
import { useState, useCallback } from 'react'
import { fetchSearch, fetchAIAnswer } from '@/lib/api'
import type { SearchResult, TabId } from '@/types'

export interface UseSearchState {
  results:   SearchResult[]
  loading:   boolean
  error:     string | null
  page:      number
  query:     string
  tab:       TabId
  lang:      string
  aiAnswer:  string
  aiModel:   string
  aiLoading: boolean
}

const INITIAL: UseSearchState = {
  results:   [],
  loading:   false,
  error:     null,
  page:      1,
  query:     '',
  tab:       'all',
  lang:      '',
  aiAnswer:  '',
  aiModel:   '',
  aiLoading: false,
}

export function useSearch() {
  const [state, setState] = useState<UseSearchState>(INITIAL)

  const search = useCallback(async (
    q: string,
    tab: TabId = 'all',
    page = 1,
    lang = '',
  ) => {
    if (!q.trim()) return

    setState(s => ({ ...s, loading: true, error: null, query: q, tab, page, lang, aiAnswer: '', aiModel: '' }))

    try {
      const data = await fetchSearch(q, tab, page, lang)
      setState(s => ({ ...s, results: data.results ?? [], loading: false }))
    } catch (e) {
      setState(s => ({ ...s, results: [], loading: false, error: 'Search failed. Is the API running?' }))
      return
    }

    if (tab === 'all') {
      setState(s => ({ ...s, aiLoading: true }))
      try {
        const ai = await fetchAIAnswer(q)
        if (ai.answer && !ai.error) {
          setState(s => ({ ...s, aiAnswer: ai.answer, aiModel: ai.model ?? '', aiLoading: false }))
        } else {
          setState(s => ({ ...s, aiLoading: false }))
        }
      } catch {
        setState(s => ({ ...s, aiLoading: false }))
      }
    }
  }, [])

  const reset = useCallback(() => setState(INITIAL), [])

  return { ...state, search, reset }
}
