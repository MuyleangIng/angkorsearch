'use client'
import { motion } from 'framer-motion'
import Favicon from '@/components/ui/Favicon'
import { getDomain, getBreadcrumb, highlightQuery } from '@/lib/utils'
import type { SearchResult } from '@/types'

interface Props {
  result:     SearchResult
  query:      string
  onBookmark: (url: string, title: string) => void
}

export default function TopResult({ result, query, onBookmark }: Props) {
  const domain  = getDomain(result.url)
  const bc      = getBreadcrumb(result.url)
  const snippet = result.snippet || highlightQuery(result.description?.slice(0, 300) ?? '', query)

  return (
    <motion.div
      className="bg-card border border-border rounded-xl p-4 mb-4 hover:border-muted/60 transition-all group"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Source */}
      <div className="flex items-center gap-2 mb-2">
        <Favicon domain={domain} size={18} />
        <div className="min-w-0">
          <span className="text-content text-sm font-medium">{domain}</span>
          <span className="text-green text-xs ml-2 truncate hidden sm:inline">{bc.slice(0, 60)}</span>
        </div>
        <button
          onClick={() => onBookmark(result.url, result.title)}
          className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-content text-sm px-2 py-1 rounded hover:bg-hover"
        >
          🔖
        </button>
      </div>

      {/* Big title */}
      <a
        href={result.url}
        target="_blank"
        rel="noreferrer"
        className="block text-blue hover:underline text-xl font-semibold leading-snug mb-2 font-khmer"
      >
        {result.title || result.url}
      </a>

      {/* Snippet */}
      {snippet && (
        <div
          className="text-muted text-sm leading-relaxed mb-3 font-khmer [&_b]:text-content [&_b]:font-semibold"
          dangerouslySetInnerHTML={{ __html: snippet }}
        />
      )}
    </motion.div>
  )
}
