'use client'
import { useState, useCallback } from 'react'
import { saveBookmark, fetchBookmarks, fetchHistory, clearHistory } from '@/lib/api'
import type { Bookmark, HistoryEntry } from '@/types'

export function useBookmark() {
  const [bookmarks, setBookmarks]   = useState<Bookmark[]>([])
  const [history, setHistory]       = useState<HistoryEntry[]>([])
  const [saving, setSaving]         = useState(false)

  const save = useCallback(async (url: string, title: string) => {
    setSaving(true)
    try { await saveBookmark(url, title) } finally { setSaving(false) }
  }, [])

  const loadBookmarks = useCallback(async () => {
    const data = await fetchBookmarks()
    setBookmarks(data)
  }, [])

  const loadHistory = useCallback(async () => {
    const data = await fetchHistory()
    setHistory(data)
  }, [])

  const deleteHistory = useCallback(async () => {
    await clearHistory()
    setHistory([])
  }, [])

  return { bookmarks, history, saving, save, loadBookmarks, loadHistory, deleteHistory }
}
