'use client'
import { useState, useCallback } from 'react'
import { fetchSearch, fetchAIAnswer } from '@/lib/api'
import type { SearchResult, TabId } from '@/types'

export interface UseSearchState {
  results:   SearchResult[]
  loading:   boolean
  retrying:  boolean
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
  retrying:  false,
  error:     null,
  page:      1,
  query:     '',
  tab:       'all',
  lang:      '',
  aiAnswer:  '',
  aiModel:   '',
  aiLoading: false,
}

const MAX_RETRIES = 3
const RETRY_DELAY = 2000

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function useSearch() {
  const [state, setState] = useState<UseSearchState>(INITIAL)

  const search = useCallback(async (
    q: string,
    tab: TabId = 'all',
    page = 1,
    lang = '',
    aiEnabled = false,
  ) => {
    if (!q.trim()) return

    setState(s => ({ ...s, loading: true, retrying: false, error: null, query: q, tab, page, lang, aiAnswer: '', aiModel: '' }))

    let lastError: unknown
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const data = await fetchSearch(q, tab, page, lang)
        setState(s => ({ ...s, results: data.results ?? [], loading: false, retrying: false }))
        lastError = null
        break
      } catch (e) {
        lastError = e
        if (attempt < MAX_RETRIES) {
          setState(s => ({ ...s, retrying: true }))
          await sleep(RETRY_DELAY)
        }
      }
    }

    if (lastError) {
      const offline = typeof navigator !== 'undefined' && !navigator.onLine
      const msg = offline
        ? 'No internet connection. Please check your Wi-Fi or mobile data.'
        : 'Search failed. Check your connection or try again.'
      setState(s => ({ ...s, results: [], loading: false, retrying: false, error: msg }))
      return
    }

    if (tab === 'all' && aiEnabled) {
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
