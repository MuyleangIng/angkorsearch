'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import Lightbox from '@/components/ui/Lightbox'
import { getDomain } from '@/lib/utils'
import type { SearchResult } from '@/types'

interface Props {
  result: SearchResult
  index:  number
}

export default function ImageResult({ result, index }: Props) {
  const [showLB, setShowLB] = useState(false)
  const domain = getDomain(result.page_url || result.url)

  return (
    <>
      <motion.div
        className="break-inside-avoid mb-3 cursor-zoom-in rounded-xl overflow-hidden border border-border bg-card2 group relative"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: index * 0.04 }}
        onClick={() => setShowLB(true)}
      >
        <img
          src={result.url}
          alt={result.alt || result.title || ''}
          className="w-full object-cover group-hover:scale-105 transition-transform duration-300"
          onError={(e) => (e.currentTarget.closest('.break-inside-avoid')?.remove())}
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/60 transition-all flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 p-3">
          <p className="text-white text-xs font-medium text-center line-clamp-2">
            {result.alt || result.title || 'Image'}
          </p>
          <p className="text-white/60 text-xs mt-1">{domain}</p>
        </div>
      </motion.div>

      {showLB && (
        <Lightbox
          src={result.url}
          alt={result.alt || result.title || ''}
          onClose={() => setShowLB(false)}
        />
      )}
    </>
  )
}
