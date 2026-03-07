'use client'
import { motion } from 'framer-motion'
import Favicon from '@/components/ui/Favicon'
import Badge from '@/components/ui/Badge'
import BookmarkButton from '@/components/ui/BookmarkButton'
import { getDomain, getBreadcrumb, highlightQuery } from '@/lib/utils'
import type { SearchResult } from '@/types'

interface Props {
  result:     SearchResult
  query:      string
  index:      number
  onBookmark?: (url: string, title: string) => void  // kept for compat, unused
}

export default function WebResult({ result, query, index }: Props) {
  const domain  = getDomain(result.url)
  const bc      = getBreadcrumb(result.url)
  const snippet = result.snippet || highlightQuery(result.description?.slice(0, 220) ?? '', query)

  return (
    <motion.div
      className="py-3 border-b border-border last:border-none group"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.25 }}
    >
      {/* Source row */}
      <div className="flex items-center gap-2 mb-1">
        <Favicon domain={domain} size={16} />
        <div className="flex flex-col min-w-0">
          <span className="text-content text-sm font-medium truncate">{domain}</span>
          <span className="text-green text-xs truncate">{bc.length > 70 ? bc.slice(0, 70) + '…' : bc}</span>
        </div>
        <BookmarkButton
          url={result.url}
          title={result.title}
          className="ml-auto opacity-0 group-hover:opacity-100"
        />
      </div>

      {/* Title */}
      <a
        href={result.url}
        target="_blank"
        rel="noreferrer"
        className="block text-[#4285f4] hover:underline text-lg font-medium leading-snug mb-1.5 font-khmer"
      >
        {result.title || result.url}
      </a>

      {/* Snippet */}
      {snippet && (
        <div
          className="text-muted text-sm leading-relaxed line-clamp-3 font-khmer [&_b]:text-content [&_b]:font-semibold"
          dangerouslySetInnerHTML={{ __html: snippet }}
        />
      )}

      {/* Badges */}
      <div className="flex gap-2 mt-2 flex-wrap">
        {result.lang === 'km' && <Badge variant="km">🇰🇭 ខ្មែរ</Badge>}
        {result.lang === 'en' && <Badge variant="en">🇬🇧 EN</Badge>}
        {result.type && result.type !== 'web' && (
          <Badge variant="type">{result.type}</Badge>
        )}
      </div>
    </motion.div>
  )
}
