'use client'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { fetchStats } from '@/lib/api'
import type { StatsData } from '@/types'

const ITEMS = [
  { key: 'pages'  as const, label: 'Pages',  color: '#4285f4' },
  { key: 'images' as const, label: 'Images', color: '#ea4335' },
  { key: 'videos' as const, label: 'Videos', color: '#fbbc05' },
  { key: 'github' as const, label: 'GitHub', color: '#3fb950' },
  { key: 'news'   as const, label: 'News',   color: '#bc8cff' },
]

export default function StatsBar() {
  const [stats, setStats] = useState<StatsData | null>(null)

  useEffect(() => {
    fetchStats().then(setStats).catch(() => {})
  }, [])

  if (!stats) return null

  return (
    <motion.div
      className="flex gap-3 flex-wrap justify-center"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, staggerChildren: 0.05 }}
    >
      {ITEMS.map((item, i) => (
        <motion.div
          key={item.key}
          className="bg-card border border-border rounded-xl px-5 py-3 text-center min-w-[80px] hover:border-muted/60 transition-colors"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 + i * 0.06 }}
        >
          <strong className="block text-xl font-bold" style={{ color: item.color }}>
            {Number(stats[item.key] || 0).toLocaleString()}
          </strong>
          <span className="text-xs text-muted mt-0.5 block">{item.label}</span>
        </motion.div>
      ))}
    </motion.div>
  )
}
