'use client'
import { motion } from 'framer-motion'

interface Props {
  page:       number
  hasMore:    boolean
  onPage:     (p: number) => void
}

export default function Pagination({ page, hasMore, onPage }: Props) {
  const total  = hasMore ? page + 4 : page
  const pages  = Array.from({ length: Math.min(total, 10) }, (_, i) => i + 1)

  return (
    <motion.nav
      className="flex items-center justify-center gap-1 mt-10 pb-6"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
    >
      {page > 1 && (
        <button
          onClick={() => onPage(page - 1)}
          className="px-4 py-2 rounded-full text-sm text-muted border border-border hover:border-muted hover:text-content transition-all"
        >
          ‹ Prev
        </button>
      )}

      {pages.map(p => (
        <button
          key={p}
          onClick={() => onPage(p)}
          className={`
            w-9 h-9 rounded-full text-sm font-medium transition-all
            ${page === p
              ? 'bg-blue text-white shadow-lg shadow-blue/30'
              : 'text-muted hover:bg-hover hover:text-content'
            }
          `}
        >
          {p}
        </button>
      ))}

      {hasMore && (
        <>
          <span className="text-muted px-1">…</span>
          <button
            onClick={() => onPage(page + 1)}
            className="px-4 py-2 rounded-full text-sm text-muted border border-border hover:border-muted hover:text-content transition-all"
          >
            Next ›
          </button>
        </>
      )}
    </motion.nav>
  )
}
