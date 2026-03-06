'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface Props {
  answer:  string
  model:   string
  loading: boolean
}

export default function AIOverview({ answer, model, loading }: Props) {
  const [expanded, setExpanded] = useState(false)
  if (!loading && !answer) return null

  const paragraphs = answer ? answer.split(/\n+/).filter(Boolean) : []
  const shown      = expanded ? paragraphs : paragraphs.slice(0, 2)
  const hasMore    = paragraphs.length > 2

  return (
    <motion.div
      className="rounded-xl border border-blue/30 bg-gradient-to-br from-blue/5 to-transparent p-4 mb-5"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <svg viewBox="0 0 24 24" width={18} height={18}>
          <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" fill="#4285f4" />
        </svg>
        <span className="text-content font-semibold text-sm">AI Overview</span>
        {model && (
          <span className="text-xs text-muted bg-card2 border border-border px-2 py-0.5 rounded-full ml-1">
            {model}
          </span>
        )}
      </div>

      {/* Loading dots */}
      {loading && (
        <div className="flex items-center gap-3 text-muted text-sm py-1">
          <div className="flex gap-1">
            {[0, 1, 2].map(i => (
              <motion.span
                key={i}
                className="w-2 h-2 rounded-full bg-blue inline-block"
                animate={{ scale: [0.6, 1, 0.6], opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.2 }}
              />
            ))}
          </div>
          Generating overview…
        </div>
      )}

      {/* Answer text */}
      {!loading && (
        <AnimatePresence mode="wait">
          <motion.div
            key={expanded ? 'exp' : 'col'}
            className="space-y-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {shown.map((p, i) => (
              <p key={i} className="text-content text-sm leading-relaxed font-khmer">{p}</p>
            ))}
            {hasMore && (
              <button
                onClick={() => setExpanded(e => !e)}
                className="text-blue text-sm hover:underline mt-1"
              >
                {expanded ? '▲ Show less' : '▼ Show more'}
              </button>
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </motion.div>
  )
}
