'use client'
import { motion } from 'framer-motion'
import { getDomain, timeSince, truncate } from '@/lib/utils'
import type { SearchResult } from '@/types'

interface Props {
  result: SearchResult
  index:  number
}

export default function NewsResult({ result, index }: Props) {
  const domain = getDomain(result.url)

  return (
    <motion.a
      href={result.url}
      target="_blank"
      rel="noreferrer"
      className="flex flex-col bg-card border border-border rounded-xl overflow-hidden hover:border-muted/60 hover:shadow-xl hover:shadow-black/30 transition-all group"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
    >
      {result.image && (
        <div className="h-44 overflow-hidden bg-card2">
          <img
            src={result.image}
            alt={result.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={(e) => (e.currentTarget.parentElement!.style.display = 'none')}
          />
        </div>
      )}
      <div className="p-4 flex flex-col gap-2 flex-1">
        <span className="text-xs text-muted uppercase tracking-wider">
          {result.source || domain}
        </span>
        <p className="text-content font-semibold text-sm leading-snug line-clamp-3 font-khmer group-hover:text-blue transition-colors">
          {result.title}
        </p>
        {result.description && (
          <p className="text-muted text-xs leading-relaxed line-clamp-2 font-khmer">
            {truncate(result.description, 130)}
          </p>
        )}
        <span className="text-xs text-muted mt-auto">
          {timeSince(result.published)}
        </span>
      </div>
    </motion.a>
  )
}
