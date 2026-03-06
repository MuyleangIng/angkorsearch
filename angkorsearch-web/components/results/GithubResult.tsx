'use client'
import { motion } from 'framer-motion'
import Badge from '@/components/ui/Badge'
import type { SearchResult } from '@/types'

const LANG_COLORS: Record<string, string> = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5',
  Go: '#00ADD8', Rust: '#dea584', Java: '#b07219', 'C++': '#f34b7d',
  C: '#555555', Ruby: '#701516', PHP: '#4F5D95', Swift: '#F05138',
  Kotlin: '#A97BFF', HTML: '#e34c26', CSS: '#563d7c', Shell: '#89e051',
}

interface Props {
  result: SearchResult
  index:  number
  onBookmark: (url: string, title: string) => void
}

export default function GithubResult({ result, index, onBookmark }: Props) {
  const langColor = result.lang ? (LANG_COLORS[result.lang] ?? '#8b949e') : '#8b949e'

  return (
    <motion.div
      className="bg-card border border-border rounded-xl p-4 hover:border-muted/60 hover:shadow-lg hover:shadow-black/20 transition-all group"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
    >
      <div className="flex items-start gap-3">
        <svg className="text-muted mt-0.5 flex-shrink-0" viewBox="0 0 16 16" width={18} height={18}>
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" fill="currentColor" />
        </svg>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <a
              href={result.url}
              target="_blank"
              rel="noreferrer"
              className="text-blue hover:underline text-base font-semibold"
            >
              {result.full_name || result.name}
            </a>
            <button
              onClick={() => onBookmark(result.url, result.full_name || result.name || '')}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-content text-sm"
            >
              🔖
            </button>
          </div>

          <p className="text-muted text-sm mt-1.5 leading-relaxed">
            {result.desc || result.description || 'No description provided.'}
          </p>

          {result.topics && result.topics.length > 0 && (
            <div className="flex gap-1.5 mt-2.5 flex-wrap">
              {result.topics.slice(0, 5).map((t, i) => (
                <Badge key={i} variant="tag">{t}</Badge>
              ))}
            </div>
          )}

          <div className="flex items-center gap-4 mt-3 text-xs text-muted flex-wrap">
            {result.lang && (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full inline-block" style={{ background: langColor }} />
                {result.lang}
              </span>
            )}
            <span>⭐ {Number(result.stars ?? 0).toLocaleString()}</span>
            <span>🍴 {Number(result.forks ?? 0).toLocaleString()}</span>
            {result.owner && <span>by {result.owner}</span>}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
