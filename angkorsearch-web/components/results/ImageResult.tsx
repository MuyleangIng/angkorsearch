'use client'
import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { getDomain } from '@/lib/utils'
import type { SearchResult } from '@/types'

interface Props {
  result:   SearchResult
  index:    number
  onSelect: (result: SearchResult) => void
}

interface CtxMenu { x: number; y: number }

export default function ImageResult({ result, index, onSelect }: Props) {
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const domain = getDomain(result.page_url || result.url)

  const handleCtx = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setCtx({ x: e.clientX, y: e.clientY })
  }, [])

  return (
    <>
      <motion.div
        className="break-inside-avoid mb-2 cursor-zoom-in rounded-lg overflow-hidden border border-white/5 bg-card2 group relative"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: Math.min(index * 0.03, 0.5) }}
        onClick={() => { setCtx(null); onSelect(result) }}
        onContextMenu={handleCtx}
      >
        <img
          src={result.url}
          alt={result.alt || result.title || ''}
          className="w-full object-cover group-hover:scale-105 transition-transform duration-500"
          onError={(e) => { const el = e.currentTarget.closest('.break-inside-avoid') as HTMLElement | null; if (el) el.style.display='none' }}
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
          <p className="text-white text-[11px] font-medium line-clamp-2 leading-tight">
            {result.alt || result.title || 'Image'}
          </p>
          <p className="text-white/50 text-[10px] mt-0.5">{domain}</p>
        </div>
      </motion.div>

      {/* Right-click context menu */}
      {ctx && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCtx(null)} />
          <div
            className="fixed z-50 bg-card border border-border rounded-xl shadow-2xl py-1 min-w-[160px] text-sm"
            style={{ left: Math.min(ctx.x, window.innerWidth - 180), top: Math.min(ctx.y, window.innerHeight - 140) }}
          >
            {[
              { label: '🔍 View details',   action: () => { onSelect(result); setCtx(null) } },
              { label: '🖼 Open full size',  action: () => { window.open(result.url, '_blank'); setCtx(null) } },
              { label: '🔗 Open source page',action: () => { window.open(result.page_url || result.url, '_blank'); setCtx(null) } },
              { label: '📋 Copy image URL',  action: () => { navigator.clipboard.writeText(result.url); setCtx(null) } },
            ].map(item => (
              <button
                key={item.label}
                onClick={item.action}
                className="w-full text-left px-4 py-2 text-content hover:bg-card2 transition-colors"
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}
