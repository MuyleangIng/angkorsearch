'use client'
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { getDomain, truncate } from '@/lib/utils'
import type { SearchResult } from '@/types'

interface Props {
  result: SearchResult
  image?: string
}

export default function KnowledgePanel({ result, image: imageProp }: Props) {
  const router = useRouter()
  const domain = getDomain(result.url)
  const isWiki = domain.includes('wikipedia')
  const desc   = truncate(result.description || result.snippet?.replace(/<[^>]+>/g, '') || '', 300)
  const [wikiImage, setWikiImage] = useState<string | null>(null)

  // Fetch Wikipedia thumbnail when result comes from Wikipedia
  useEffect(() => {
    if (!isWiki) { setWikiImage(null); return }
    const pageTitle = result.title?.trim()
    if (!pageTitle) return
    const lang = domain.startsWith('km.') ? 'km' : domain.startsWith('fr.') ? 'fr' : 'en'
    fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.thumbnail?.source) setWikiImage(d.thumbnail.source) })
      .catch(() => null)
  }, [result.url, result.title])

  const displayImage = imageProp || wikiImage

  const related = [
    result.title,
    `${result.title} history`,
    `${result.title} news`,
    `${result.title} facts`,
  ].filter(Boolean) as string[]

  function goSearch(q: string) {
    router.push(`/search?q=${encodeURIComponent(q)}&tab=all`)
  }

  return (
    <motion.aside
      className="bg-card border border-border rounded-xl overflow-hidden sticky top-28"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.2, duration: 0.35 }}
    >
      {/* Hero image */}
      {displayImage && (
        <div className="h-44 overflow-hidden bg-card2 relative">
          <img
            src={displayImage}
            alt={result.title}
            className="w-full h-full object-cover"
            onError={e => (e.currentTarget.parentElement!.style.display = 'none')}
          />
          {isWiki && (
            <span className="absolute bottom-2 right-2 text-[9px] bg-black/50 text-white px-1.5 py-0.5 rounded">
              Wikipedia
            </span>
          )}
        </div>
      )}

      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h2 className="text-content text-lg font-semibold leading-snug font-khmer">
            {result.title}
          </h2>
          {isWiki && !displayImage && (
            <span className="text-[10px] text-muted bg-hover border border-border px-2 py-0.5 rounded flex-shrink-0 mt-0.5">
              Wikipedia
            </span>
          )}
        </div>

        <p className="text-muted text-sm leading-relaxed mb-3 font-khmer">{desc}</p>

        {/* Meta table */}
        <div className="border-t border-border pt-3 mb-3">
          <table className="w-full text-xs">
            <tbody>
              <tr>
                <td className="text-muted font-medium py-1.5 pr-3 w-20 align-top">Source</td>
                <td>
                  <a href={result.url} target="_blank" rel="noreferrer" className="text-blue hover:underline truncate block max-w-[160px]">
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

        {/* Related searches */}
        <div className="border-t border-border pt-3 mb-3">
          <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">Related searches</p>
          <div className="space-y-1.5">
            {related.map((r, i) => (
              <button
                key={i}
                onClick={() => goSearch(r)}
                className="flex items-center gap-2 text-xs text-muted hover:text-blue transition-colors font-khmer w-full text-left"
              >
                <svg viewBox="0 0 24 24" width={12} height={12} className="flex-shrink-0 text-muted/60">
                  <path d="M15.5 14h-.79l-.28-.27A6.5 6.5 0 1 0 14 15.5l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" fill="currentColor"/>
                </svg>
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Read more */}
        <div className="border-t border-border pt-3">
          <a
            href={result.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between text-xs text-blue hover:underline font-medium"
          >
            <span>Read full article</span>
            <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
        </div>
      </div>
    </motion.aside>
  )
}
