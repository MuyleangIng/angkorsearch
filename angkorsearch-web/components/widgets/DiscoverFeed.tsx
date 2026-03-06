'use client'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { fetchLive } from '@/lib/api'
import { getDomain, timeSince } from '@/lib/utils'
import type { LivePage } from '@/types'

export default function DiscoverFeed() {
  const [items, setItems]   = useState<LivePage[]>([])
  const [total, setTotal]   = useState(0)
  const [queue, setQueue]   = useState(0)

  useEffect(() => {
    const load = () => {
      fetchLive(10)
        .then(d => {
          setTotal(d.total_pages ?? 0)
          setQueue(d.queue_remaining ?? 0)
          setItems(d.latest ?? [])
        })
        .catch(() => {})
    }
    load()
    const iv = setInterval(load, 4000)
    return () => clearInterval(iv)
  }, [])

  if (!items.length) return null

  return (
    <section className="mt-10 w-full max-w-5xl mx-auto px-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <span className="w-2 h-2 rounded-full bg-green animate-pulse-dot" />
        <span className="text-content font-semibold text-sm">Discover · Live Crawl</span>
        <span className="text-muted text-xs">
          {Number(total).toLocaleString()} pages indexed
          {queue > 0 && ` · ${Number(queue).toLocaleString()} queued`}
        </span>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {items.slice(0, 8).map((item, i) => (
          <motion.a
            key={i}
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="bg-card border border-border rounded-xl overflow-hidden hover:border-muted/60 hover:shadow-xl hover:shadow-black/30 transition-all group block"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <div className="h-32 overflow-hidden bg-card2">
              {(item as LivePage & { image?: string }).image ? (
                <img
                  src={(item as LivePage & { image?: string }).image}
                  alt={item.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  onError={(e) => (e.currentTarget.parentElement!.style.display = 'none')}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-3xl text-muted">
                  {item.lang === 'km' ? '🇰🇭' : '🌐'}
                </div>
              )}
            </div>
            <div className="p-3">
              <span className="text-xs text-muted block mb-1 truncate">{getDomain(item.url)}</span>
              <p className="text-content text-xs font-medium line-clamp-2 leading-relaxed font-khmer group-hover:text-blue transition-colors">
                {item.title || item.url}
              </p>
              <span className="text-xs text-muted mt-1.5 block">{timeSince(item.at)}</span>
            </div>
          </motion.a>
        ))}
      </div>
    </section>
  )
}
