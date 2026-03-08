import axios from 'axios'
import type {
  SearchResponse, SuggestResponse, StatsData,
  LiveResponse, AIAnswerResponse, Bookmark, HistoryEntry,
} from '@/types'
import { API_URL, USER_ID } from './constants'

export const http = axios.create({
  baseURL: API_URL,
  timeout: 60_000,
})

// ─── Search ───────────────────────────────────────────────────────────────────

export async function fetchSearch(
  q: string,
  type: string,
  page = 1,
  lang = '',
): Promise<SearchResponse> {
  const params: Record<string, string | number> = { q, type: type === 'all' ? 'web' : type, page }
  if (lang) params.lang = lang
  const { data } = await http.get<SearchResponse>('/search', { params })
  return data
}

// ─── Suggestions ─────────────────────────────────────────────────────────────

export async function fetchSuggestions(q: string): Promise<string[]> {
  if (!q.trim()) return []
  const { data } = await http.get<SuggestResponse>('/suggest', { params: { q } })
  return data.suggestions ?? []
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export async function fetchStats(): Promise<StatsData> {
  const { data } = await http.get<StatsData>('/stats')
  return data
}

// ─── Live ─────────────────────────────────────────────────────────────────────

export async function fetchLive(since = 10): Promise<LiveResponse> {
  const { data } = await http.get<LiveResponse>('/live', { params: { since } })
  return data
}

// ─── AI Answer ────────────────────────────────────────────────────────────────

export async function fetchAIAnswer(q: string): Promise<AIAnswerResponse> {
  const { data } = await http.get<AIAnswerResponse>('/ai/answer', {
    params: { q },
    timeout: 200_000,
  })
  return data
}

// ─── Bookmarks ────────────────────────────────────────────────────────────────

export async function fetchBookmarks(): Promise<Bookmark[]> {
  const { data } = await http.get<{ bookmarks: Bookmark[] }>('/bookmarks', {
    params: { user_id: USER_ID },
  })
  return data.bookmarks ?? []
}

export async function saveBookmark(url: string, title: string): Promise<void> {
  await http.post('/bookmark', new URLSearchParams({
    user_id: String(USER_ID), url, title,
  }))
}

// ─── History ─────────────────────────────────────────────────────────────────

export async function fetchHistory(): Promise<HistoryEntry[]> {
  const { data } = await http.get<{ history: HistoryEntry[] }>('/history', {
    params: { user_id: USER_ID },
  })
  return data.history ?? []
}

export async function clearHistory(): Promise<void> {
  await http.delete('/history', { params: { user_id: USER_ID } })
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export async function fetchAdminSystem() {
  const { data } = await http.get('/admin/system')
  return data
}

export async function updateSeed(id: number, patch: { active?: boolean; priority?: number }) {
  const body = new URLSearchParams({ id: String(id) })
  if (patch.active !== undefined) body.set('active', String(patch.active))
  if (patch.priority !== undefined) body.set('priority', String(patch.priority))
  await http.patch('/admin/seeds', body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
}
