'use client'
import { motion } from 'framer-motion'
import { timeSince, truncate } from '@/lib/utils'
import type { SearchResult } from '@/types'

interface Props {
  result: SearchResult
  index:  number
}

export default function VideoResult({ result, index }: Props) {
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
      <div className="relative h-40 overflow-hidden bg-card2">
        {result.thumb ? (
          <img
            src={result.thumb}
            alt={result.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={(e) => (e.currentTarget.parentElement!.style.display = 'none')}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-5xl text-muted">▶</div>
        )}
        {result.duration && (
          <span className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-0.5 rounded">
            {result.duration}
          </span>
        )}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-12 h-12 rounded-full bg-black/70 flex items-center justify-center">
            <span className="text-white text-xl ml-1">▶</span>
          </div>
        </div>
      </div>

      <div className="p-3 space-y-1">
        <p className="text-content text-sm font-semibold line-clamp-2 leading-snug group-hover:text-blue transition-colors">
          {result.title}
        </p>
        {result.channel && (
          <p className="text-muted text-xs">📺 {result.channel}</p>
        )}
        <p className="text-muted text-xs">{timeSince(result.published)}</p>
      </div>
    </motion.a>
  )
}
