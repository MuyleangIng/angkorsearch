import type { Tab } from '@/types'

export const API_URL =
  typeof window === 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080')
    : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080')

export const USER_ID = 1

export const TABS: Tab[] = [
  { id: 'all',       label: 'All'     },
  { id: 'news',      label: 'News'    },
  { id: 'image',     label: 'Images'  },
  { id: 'video',     label: 'Videos'  },
  { id: 'github',    label: 'GitHub'  },
  { id: 'bookmarks', label: 'Saved'   },
  { id: 'history',   label: 'History' },
]

export const QUICK_SEARCHES = [
  'ភ្នំពេញ',
  'អង្គរវត្ត',
  'Cambodia tech',
  'Angkor Wat',
  'Khmer Empire',
  'Naruto',
  'One Piece',
  'MekongTunnel',
]

export const LANGUAGE_OPTIONS = [
  { value: '',   label: 'All' },
  { value: 'km', label: '🇰🇭 ខ្មែរ' },
  { value: 'en', label: '🇬🇧 English' },
]
