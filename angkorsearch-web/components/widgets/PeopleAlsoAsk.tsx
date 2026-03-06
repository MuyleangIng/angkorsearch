'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { generatePAAQuestions } from '@/lib/utils'
import { fetchAIAnswer } from '@/lib/api'

interface Props {
  query: string
}

export default function PeopleAlsoAsk({ query }: Props) {
  const questions = generatePAAQuestions(query)
  const [open,    setOpen]    = useState<number | null>(null)
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState<Record<number, boolean>>({})

  async function toggle(i: number) {
    if (open === i) { setOpen(null); return }
    setOpen(i)
    if (answers[i]) return
    setLoading(l => ({ ...l, [i]: true }))
    try {
      const r = await fetchAIAnswer(questions[i])
      setAnswers(a => ({ ...a, [i]: r.answer || 'No answer available.' }))
    } catch {
      setAnswers(a => ({ ...a, [i]: 'Could not load answer.' }))
    } finally {
      setLoading(l => ({ ...l, [i]: false }))
    }
  }

  return (
    <motion.div
      className="rounded-xl border border-border overflow-hidden mb-5"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25 }}
    >
      <h3 className="text-content font-semibold text-sm px-4 py-3 border-b border-border bg-card">
        People also ask
      </h3>

      {questions.map((q, i) => (
        <div key={i} className="border-b border-border last:border-none">
          <button
            className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left text-sm text-content hover:bg-card2 transition-colors font-khmer"
            onClick={() => toggle(i)}
          >
            <span>{q}</span>
            <motion.svg
              viewBox="0 0 24 24"
              width={18}
              height={18}
              className="text-muted flex-shrink-0"
              animate={{ rotate: open === i ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <path d="M7 10l5 5 5-5z" fill="currentColor" />
            </motion.svg>
          </button>

          <AnimatePresence>
            {open === i && (
              <motion.div
                className="px-4 pb-4 border-t border-border bg-card2"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                style={{ overflow: 'hidden' }}
              >
                <div className="pt-3">
                  {loading[i] ? (
                    <div className="flex items-center gap-2 text-muted text-sm">
                      <motion.div
                        className="w-3.5 h-3.5 rounded-full border-2 border-border border-t-blue"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}
                      />
                      Thinking…
                    </div>
                  ) : (
                    <p className="text-muted text-sm leading-relaxed font-khmer">{answers[i]}</p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </motion.div>
  )
}
