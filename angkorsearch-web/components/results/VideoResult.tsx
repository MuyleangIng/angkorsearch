'use client'
import { motion } from 'framer-motion'
import { timeSince } from '@/lib/utils'
import type { SearchResult } from '@/types'

interface Props {
  result: SearchResult
  index:  number
}

function getPlatform(url: string) {
  if (url.includes('youtube.com') || url.includes('youtu.be'))
    return { name: 'YouTube',  color: '#FF0000', bg: 'bg-red-600',    icon: '▶' }
  if (url.includes('tiktok.com'))
    return { name: 'TikTok',   color: '#69C9D0', bg: 'bg-cyan-500',   icon: '♪' }
  if (url.includes('facebook.com') || url.includes('fb.com'))
    return { name: 'Facebook', color: '#4267B2', bg: 'bg-blue-600',   icon: 'f' }
  if (url.includes('twitter.com') || url.includes('x.com'))
    return { name: 'X',        color: '#ffffff', bg: 'bg-neutral-900',icon: '𝕏' }
  if (url.includes('vimeo.com'))
    return { name: 'Vimeo',    color: '#1AB7EA', bg: 'bg-sky-500',    icon: '▶' }
  if (url.includes('instagram.com'))
    return { name: 'Instagram',color: '#E1306C', bg: 'bg-pink-600',   icon: '▶' }
  try {
    return { name: new URL(url).hostname.replace('www.',''), color: '#8b949e', bg: 'bg-neutral-700', icon: '▶' }
  } catch {
    return { name: 'Video', color: '#8b949e', bg: 'bg-neutral-700', icon: '▶' }
  }
}

export default function VideoResult({ result, index }: Props) {
  const platform = getPlatform(result.url)

  return (
    <motion.a
      href={result.url}
      target="_blank"
      rel="noreferrer"
      className="flex flex-col bg-card border border-border rounded-xl overflow-hidden hover:border-white/20 hover:shadow-2xl hover:shadow-black/40 transition-all group"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.05, 0.6) }}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video overflow-hidden bg-card2">
        {result.thumb ? (
          <img
            src={result.thumb}
            alt={result.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display='none' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-card2 to-primary">
            <span className="text-4xl text-muted/40">{platform.icon}</span>
          </div>
        )}

        {/* Play button overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-14 h-14 rounded-full bg-black/70 backdrop-blur flex items-center justify-center shadow-xl">
            <span className="text-white text-2xl ml-1">▶</span>
          </div>
        </div>

        {/* Platform badge */}
        <span className={`absolute top-2 left-2 ${platform.bg} text-white text-[10px] font-bold px-2 py-0.5 rounded-full`}>
          {platform.name}
        </span>

        {/* Duration */}
        {result.duration && (
          <span className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-0.5 rounded font-mono">
            {result.duration}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-3 space-y-1.5">
        <p className="text-content text-sm font-semibold line-clamp-2 leading-snug group-hover:text-blue transition-colors">
          {result.title || 'Untitled'}
        </p>
        {result.channel && (
          <p className="text-muted text-xs flex items-center gap-1">
            <span className="w-3 h-3 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: platform.color }} />
            {result.channel}
          </p>
        )}
        <p className="text-muted text-[11px]">{timeSince(result.published)}</p>
      </div>
    </motion.a>
  )
}
