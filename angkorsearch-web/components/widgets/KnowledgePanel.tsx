'use client'
import { motion } from 'framer-motion'
import { getDomain, truncate } from '@/lib/utils'
import type { SearchResult } from '@/types'

interface Props {
  result: SearchResult
  image?: string
}

export default function KnowledgePanel({ result, image }: Props) {
  const domain = getDomain(result.url)
  const isWiki = domain.includes('wikipedia')
  const desc   = truncate(result.description || result.snippet?.replace(/<[^>]+>/g, '') || '', 280)

  const related = [
    `History of ${result.title}`,
    `${result.title} location`,
    `${result.title} facts`,
    `Visit ${result.title}`,
  ]

  return (
    <motion.aside
      className="bg-card border border-border rounded-xl overflow-hidden sticky top-28"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.2, duration: 0.35 }}
    >
      {/* Image */}
      {image && (
        <div className="h-48 overflow-hidden bg-card2">
          <img
            src={image}
            alt={result.title}
            className="w-full h-full object-cover"
            onError={(e) => (e.currentTarget.parentElement!.style.display = 'none')}
          />
        </div>
      )}

      <div className="p-4">
        <h2 className="text-content text-xl font-semibold leading-snug mb-1 font-khmer">
          {result.title}
        </h2>
        {isWiki && (
          <span className="text-xs text-muted bg-hover border border-border px-2 py-0.5 rounded text-[10px] inline-block mb-2">
            Wikipedia
          </span>
        )}

        <p className="text-muted text-sm leading-relaxed mb-3 font-khmer">{desc}</p>

        <div className="border-t border-border pt-3 mb-3">
          <table className="w-full text-xs">
            <tbody>
              <tr>
                <td className="text-muted font-medium py-1.5 pr-3 w-20 align-top">Source</td>
                <td>
                  <a href={result.url} target="_blank" rel="noreferrer" className="text-blue hover:underline truncate block">
                    {domain}
                  </a>
                </td>
              </tr>
              <tr>
                <td className="text-muted font-medium py-1.5 pr-3 align-top">Language</td>
                <td className="text-content">
                  {result.lang === 'km' ? '🇰🇭 Khmer' : result.lang === 'en' ? '🇬🇧 English' : result.lang || '–'}
                </td>
              </tr>
              <tr>
                <td className="text-muted font-medium py-1.5 pr-3 align-top">Type</td>
                <td className="text-content capitalize">{result.type || 'Web'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Related */}
        <div className="border-t border-border pt-3 mb-3">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Related searches</p>
          <div className="space-y-1.5">
            {related.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-muted hover:text-blue cursor-pointer transition-colors font-khmer">
                <svg viewBox="0 0 24 24" width={12} height={12} className="flex-shrink-0">
                  <path d="M15.5 14h-.79l-.28-.27A6.5 6.5 0 1 0 14 15.5l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" fill="currentColor" />
                </svg>
                {r}
              </div>
            ))}
          </div>
        </div>

        {/* Deep dive */}
        <div className="border-t border-border pt-3">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Deep dive</p>
          <div className="space-y-1.5">
            {[`Best of ${result.title}`, `${result.title} culture`, `${result.title} guide`].map((s, i) => (
              <p key={i} className="text-xs text-blue hover:underline cursor-pointer font-khmer">› {s}</p>
            ))}
          </div>
        </div>
      </div>
    </motion.aside>
  )
}
