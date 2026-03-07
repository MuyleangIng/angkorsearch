// ─── Search ───────────────────────────────────────────────────────────────────

export interface SearchResult {
  id:          number
  url:         string
  title:       string
  description: string
  snippet:     string
  lang:        string
  type:        string
  score:       number
  image?:      string
  source?:     string
  published?:  string
  thumb?:      string
  duration?:   string
  channel?:    string
  alt?:        string
  page_url?:   string
  domain?:     string
  full_name?:  string
  name?:       string
  desc?:       string
  stars?:      number
  forks?:      number
  owner?:      string
  topics?:     string[]
}

export type NewsResult   = SearchResult
export type ImageResult  = SearchResult
export type VideoResult  = SearchResult
export type GithubRepo   = SearchResult

export interface SearchResponse {
  type:    string
  query:   string
  page:    number
  results: SearchResult[]
  count:   number
  error?:  string
}

// ─── Suggestions ─────────────────────────────────────────────────────────────

export interface SuggestResponse {
  suggestions: string[]
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export interface StatsData {
  pages:  number
  images: number
  videos: number
  github: number
  news:   number
}

// ─── Live / Discover ─────────────────────────────────────────────────────────

export interface LivePage {
  url:    string
  title:  string
  domain: string
  lang:   string
  type:   string
  at:     string
  image?: string
}

export interface LiveResponse {
  total_pages:     number
  queue_remaining: number
  latest:          LivePage[]
}

// ─── AI ───────────────────────────────────────────────────────────────────────

export interface AIAnswerResponse {
  answer:  string
  model:   string
  error?:  string
}

// ─── Bookmark / History ───────────────────────────────────────────────────────

export interface Bookmark {
  url:      string
  title:    string
  folder:   string
  saved_at: string
}

export interface HistoryEntry {
  query:   string
  type:    string
  results: number
  at:      string
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

export type TabId = 'all' | 'news' | 'image' | 'video' | 'github' | 'ai' | 'bookmarks' | 'history'

export interface Tab {
  id:    TabId
  label: string
  icon?: string
}
