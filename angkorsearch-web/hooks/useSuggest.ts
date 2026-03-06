'use client'
import { useState, useEffect } from 'react'
import { fetchSuggestions } from '@/lib/api'
import { useDebounce } from './useDebounce'

export function useSuggest(query: string) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const debounced = useDebounce(query, 180)

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
