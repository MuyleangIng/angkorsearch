'use client'
import { motion } from 'framer-motion'
import Badge from '@/components/ui/Badge'
import { getDomain } from '@/lib/utils'
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

function getSourceIcon(url: string) {
  if (url.includes('github.com')) return (
    <svg viewBox="0 0 16 16" width={16} height={16} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
    </svg>
  )
  if (url.includes('gitlab.com')) return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="#FC6D26">
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z"/>
    </svg>
  )
  if (url.includes('dev.to') || url.includes('hashnode') || url.includes('medium.com')) return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>
  )
  // Generic code/blog icon
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
    </svg>
  )
}

function getSourceBadge(url: string, result: SearchResult): { label: string; color: string } | null {
  if (url.includes('github.com'))  return { label: 'GitHub',    color: '#8b949e' }
  if (url.includes('gitlab.com'))  return { label: 'GitLab',    color: '#FC6D26' }
  if (url.includes('dev.to'))      return { label: 'DEV',       color: '#3b49df' }
  if (url.includes('hashnode'))    return { label: 'Hashnode',  color: '#2962FF' }
  if (url.includes('medium.com'))  return { label: 'Medium',    color: '#00ab6c' }
  if (url.includes('huggingface')) return { label: 'HuggingFace', color: '#ff9d00' }
  if (url.includes('arxiv.org'))   return { label: 'arXiv',     color: '#b31b1b' }
  if (url.includes('stackoverflow')) return { label: 'Stack Overflow', color: '#f48024' }
  if (url.includes('npmjs.com'))   return { label: 'npm',       color: '#cb3837' }
  if (url.includes('pypi.org'))    return { label: 'PyPI',      color: '#3572A5' }

  // detect Cambodian dev content by domain or lang
  const domain = getDomain(url)
  if (result.lang === 'km' || domain.endsWith('.com.kh') || domain.endsWith('.kh'))
    return { label: 'KH Dev', color: '#0050a0' }

  // topic-based detection
  const text = ((result.title || '') + ' ' + (result.desc || result.description || '')).toLowerCase()
  if (text.match(/\b(quantum|qubit|qpu)\b/))   return { label: 'Quantum',    color: '#7c3aed' }
  if (text.match(/\b(llm|ai model|gpt|gemini|claude|ollama|transformer)\b/)) return { label: 'AI / ML', color: '#059669' }
  if (text.match(/\b(open.?source|oss|foss)\b/))  return { label: 'Open Source', color: '#16a34a' }

  return null
}

export default function GithubResult({ result, index, onBookmark }: Props) {
  const url       = result.url
  const domain    = getDomain(url)
  const langColor = result.lang ? (LANG_COLORS[result.lang] ?? '#8b949e') : null
  const badge     = getSourceBadge(url, result)
  const isRepo    = url.includes('github.com') || url.includes('gitlab.com')
  const desc      = result.desc || result.description || 'No description provided.'
  const title     = result.full_name || result.name || result.title || url

  return (
    <motion.div
      className="bg-card border border-border rounded-xl p-4 hover:border-muted/60 hover:shadow-lg hover:shadow-black/20 transition-all group"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
    >
      <div className="flex items-start gap-3">
        {/* Source icon */}
        <span className="text-muted mt-0.5 flex-shrink-0 w-[18px] flex items-center justify-center">
          {getSourceIcon(url)}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-blue hover:underline text-base font-semibold truncate"
              >
                {title}
              </a>
              {badge && (
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0"
                  style={{ color: badge.color, borderColor: badge.color + '55', background: badge.color + '15' }}
                >
                  {badge.label}
                </span>
              )}
            </div>
            <button
              onClick={() => onBookmark(url, title)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-content text-sm flex-shrink-0"
            >
              🔖
            </button>
          </div>

          {/* Domain breadcrumb */}
          <p className="text-green text-xs mt-0.5 truncate">{domain}</p>

          <p className="text-muted text-sm mt-1.5 leading-relaxed line-clamp-3">
            {desc}
          </p>

          {/* Topics */}
          {result.topics && result.topics.length > 0 && (
            <div className="flex gap-1.5 mt-2.5 flex-wrap">
              {result.topics.slice(0, 6).map((t, i) => (
                <Badge key={i} variant="tag">{t}</Badge>
              ))}
            </div>
          )}

          {/* Repo stats row */}
          <div className="flex items-center gap-4 mt-3 text-xs text-muted flex-wrap">
            {langColor && result.lang && (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full inline-block flex-shrink-0" style={{ background: langColor }} />
                {result.lang}
              </span>
            )}
            {isRepo && (
              <>
                <span className="flex items-center gap-1">
                  <svg viewBox="0 0 16 16" width={12} height={12} fill="currentColor" className="text-yellow">
                    <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"/>
                  </svg>
                  {Number(result.stars ?? 0).toLocaleString()}
                </span>
                <span className="flex items-center gap-1">
                  <svg viewBox="0 0 16 16" width={12} height={12} fill="currentColor" className="text-muted">
                    <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/>
                  </svg>
                  {Number(result.forks ?? 0).toLocaleString()}
                </span>
              </>
            )}
            {result.owner && <span className="truncate">by {result.owner}</span>}
            {!isRepo && result.published_at && (
              <span>{new Date(result.published_at).toLocaleDateString()}</span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
