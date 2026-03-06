import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function getBreadcrumb(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    const parts = u.pathname.split('/').filter(Boolean).slice(0, 3)
    return [host, ...parts].join(' › ')
  } catch {
    return url
  }
}

export function getFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?sz=32&domain=${domain}`
}

export function timeSince(dateStr: string | undefined): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(dateStr).toLocaleDateString()
}

export function isKhmer(text: string): boolean {
  return /[\u1780-\u17FF]/.test(text)
}

export function highlightQuery(text: string, query: string): string {
  if (!query || !text) return text
  const words = query.trim().split(/\s+/).filter(w => w.length > 2)
  if (!words.length) return text
  const escaped = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(${escaped.join('|')})`, 'gi')
  return text.replace(re, '<b>$1</b>')
}

export function generatePAAQuestions(query: string): string[] {
  if (isKhmer(query)) {
    return [
      `${query} ជាអ្វី?`,
      `${query} នៅឯណា?`,
      `ប្រវត្តិ ${query}`,
      `${query} ល្បីដោយហេតុអ្វី?`,
    ]
  }

  const q = query.toLowerCase()

  const placeWords  = ['wat', 'angkor', 'phnom', 'siem', 'cambodia', 'temple', 'park', 'lake', 'river', 'mountain', 'city']
  const animeWords  = ['naruto', 'piece', 'dragon ball', 'bleach', 'attack on titan', 'demon slayer', 'jujutsu', 'hunter', 'hero', 'academia', 'overlord', 'slime', 'solo leveling']
  const personWords = ['king', 'queen', 'president', 'prime minister', 'actor', 'singer', 'writer']

  if (animeWords.some(w => q.includes(w))) {
    return [
      `What is ${query} about?`,
      `Who created ${query}?`,
      `How many episodes does ${query} have?`,
      `Is ${query} manga or anime?`,
    ]
  }

  if (placeWords.some(w => q.includes(w))) {
    return [
      `What is ${query}?`,
      `Where is ${query} located?`,
      `How to visit ${query}?`,
      `Best time to visit ${query}?`,
    ]
  }

  if (personWords.some(w => q.includes(w))) {
    return [
      `Who is ${query}?`,
      `What is ${query} known for?`,
      `When was ${query} born?`,
      `Where is ${query} from?`,
    ]
  }

  return [
    `What is ${query}?`,
    `Why is ${query} important?`,
    `History of ${query}`,
    `${query} key facts`,
  ]
}

export function truncate(text: string, max: number): string {
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '…' : text
}
