'use client'
import { useState, useEffect } from 'react'
import { fetchSuggestions } from '@/lib/api'
import { useDebounce } from './useDebounce'

const RECENT_KEY = 'angkor_recent_searches'
const MAX_RECENT = 8

export function getRecentSearches(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') } catch { return [] }
}

export function saveRecentSearch(q: string) {
  try {
    const prev = getRecentSearches().filter(s => s !== q)
    localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...prev].slice(0, MAX_RECENT)))
  } catch { /* ignore */ }
}

export function clearRecentSearches() {
  try { localStorage.removeItem(RECENT_KEY) } catch { /* ignore */ }
}

export function useSuggest(query: string) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const debounced = useDebounce(query, 100)

  useEffect(() => {
    if (debounced.length < 1) { setSuggestions([]); return }
    let cancelled = false
    setLoading(true)
    fetchSuggestions(debounced)
      .then(s => { if (!cancelled) setSuggestions(s) })
      .catch(() => { if (!cancelled) setSuggestions([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [debounced])

  return { suggestions, loading, clear: () => setSuggestions([]) }
}
