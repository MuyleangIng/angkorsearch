'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useSuggest } from '@/hooks/useSuggest'
import type { TabId } from '@/types'

interface Props {
  initialValue?: string
  currentTab?:   TabId
  compact?:      boolean
  onSearch?:     (q: string) => void
}

export default function SearchBox({ initialValue = '', currentTab = 'all', compact = false, onSearch }: Props) {
  const router  = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue]     = useState(initialValue)
  const [focused, setFocused] = useState(false)
  const { suggestions, clear } = useSuggest(value)

  const showSug = focused && suggestions.length > 0

  function submit(q: string) {
    if (!q.trim()) return
    clear()
    setFocused(false)
    if (onSearch) {
      onSearch(q)
    } else {
      router.push(`/search?q=${encodeURIComponent(q)}&tab=${currentTab}`)
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') submit(value)
    if (e.key === 'Escape') { setFocused(false); clear() }
  }

  return (
    <div className="relative w-full">
      <div className={`
        flex items-center gap-2 bg-card border border-border
        rounded-full transition-all duration-200
        ${compact ? 'px-3 py-2' : 'px-4 py-3'}
        ${focused ? 'border-blue shadow-[0_0_0_3px_rgba(66,133,244,0.18)]' : 'hover:border-muted'}
      `}>
        {/* Search icon */}
        <svg className="text-muted flex-shrink-0" viewBox="0 0 24 24" width={compact ? 18 : 20} height={compact ? 18 : 20}>
          <path d="M15.5 14h-.79l-.28-.27A6.5 6.5 0 1 0 14 15.5l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" fill="currentColor" />
        </svg>

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKey}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
          placeholder={compact ? 'Search…' : 'ស្វែងរក · Search Cambodia, Khmer, Anime…'}
          className={`
            flex-1 bg-transparent outline-none text-content placeholder:text-muted min-w-0
            font-khmer ${compact ? 'text-sm' : 'text-base'}
          `}
          autoComplete="off"
          spellCheck={false}
        />

        {/* Clear */}
        {value && (
          <button
            onClick={() => { setValue(''); inputRef.current?.focus() }}
            className="text-muted hover:text-content transition-colors p-1 rounded-full hover:bg-hover"
          >
            <svg viewBox="0 0 24 24" width={16} height={16}>
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor" />
            </svg>
          </button>
        )}

        <div className="w-px h-5 bg-border flex-shrink-0" />

        {/* Mic */}
        <button className="text-blue hover:opacity-80 transition-opacity p-1 rounded-full hover:bg-hover">
          <svg viewBox="0 0 24 24" width={18} height={18}>
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" fill="currentColor" />
          </svg>
        </button>

        {/* Camera (hero only) */}
        {!compact && (
          <button className="text-blue hover:opacity-80 transition-opacity p-1 rounded-full hover:bg-hover">
            <svg viewBox="0 0 24 24" width={18} height={18}>
              <path d="M12 15.2A3.2 3.2 0 1 1 12 8.8a3.2 3.2 0 0 1 0 6.4zm0-8.4a5.2 5.2 0 1 0 0 10.4A5.2 5.2 0 0 0 12 6.8zM20 4h-3.17L15 2H9L7.17 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" fill="currentColor" />
            </svg>
          </button>
        )}

        {/* Search button */}
        <button
          onClick={() => submit(value)}
          className="bg-blue hover:bg-blue/90 text-white rounded-full px-3 py-1.5 text-sm font-medium transition-all hover:scale-105 flex-shrink-0 flex items-center gap-1.5"
        >
          <svg viewBox="0 0 24 24" width={16} height={16}>
            <path d="M15.5 14h-.79l-.28-.27A6.5 6.5 0 1 0 14 15.5l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" fill="currentColor" />
          </svg>
          {!compact && <span>ស្វែងរក</span>}
        </button>
      </div>

      {/* Suggestions dropdown */}
      <AnimatePresence>
        {showSug && (
          <motion.div
            className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-2xl shadow-2xl shadow-black/50 overflow-hidden z-50"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            {suggestions.map((s, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-hover transition-colors text-content text-sm font-khmer"
                onMouseDown={() => { setValue(s); submit(s) }}
              >
                <svg className="text-muted flex-shrink-0" viewBox="0 0 24 24" width={14} height={14}>
                  <path d="M15.5 14h-.79l-.28-.27A6.5 6.5 0 1 0 14 15.5l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" fill="currentColor" />
                </svg>
                {s}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
