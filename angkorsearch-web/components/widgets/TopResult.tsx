'use client'
import { motion } from 'framer-motion'
import { useState, useEffect } from 'react'
import Favicon from '@/components/ui/Favicon'
import BookmarkButton from '@/components/ui/BookmarkButton'
import { getDomain, getBreadcrumb, highlightQuery } from '@/lib/utils'
import { API_URL } from '@/lib/constants'
import type { SearchResult } from '@/types'

interface SiteLink { url: string; title: string; desc: string }

interface Props {
  result:      SearchResult
  query:       string
  onBookmark?: (url: string, title: string) => void
}

export default function TopResult({ result, query }: Props) {
  const domain   = getDomain(result.url)
  const bc       = getBreadcrumb(result.url)
  const snippet  = result.snippet || highlightQuery(result.description?.slice(0, 300) ?? '', query)
  const [sitelinks, setSitelinks] = useState<SiteLink[]>([])

  useEffect(() => {
    if (!domain) return
    fetch(`${API_URL}/sitelinks?domain=${encodeURIComponent(domain)}&exclude=${encodeURIComponent(result.url)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.links)) setSitelinks(d.links) })
      .catch(() => {})
  }, [domain, result.url])

  // Shorten sitelink title to sub-path label
  function slLabel(url: string, title: string) {
    try {
      const path = new URL(url).pathname.split('/').filter(Boolean)
      if (path.length > 0) return path[path.length - 1].replace(/[-_]/g,' ').replace(/\.(html?|php|aspx?)$/i,'')
    } catch { /* */ }
    return title.split('–')[0].split('|')[0].trim().slice(0, 30)
  }

  return (
    <motion.div
      className="bg-card border border-border rounded-xl p-4 mb-4 hover:border-muted/60 transition-all group"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Source */}
      <div className="flex items-center gap-2 mb-2">
        <Favicon domain={domain} size={18} />
        <div className="min-w-0">
          <span className="text-content text-sm font-medium">{domain}</span>
          <span className="text-green text-xs ml-2 truncate hidden sm:inline">{bc.slice(0, 60)}</span>
        </div>
        <BookmarkButton url={result.url} title={result.title} className="ml-auto opacity-0 group-hover:opacity-100" />
      </div>

      {/* Big title */}
      <a href={result.url} target="_blank" rel="noreferrer"
        className="block text-blue hover:underline text-xl font-semibold leading-snug mb-2 font-khmer">
        {result.title || result.url}
      </a>

      {/* Snippet */}
      {snippet && (
        <div className="text-muted text-sm leading-relaxed mb-3 font-khmer [&_b]:text-content [&_b]:font-semibold"
          dangerouslySetInnerHTML={{ __html: snippet }} />
      )}

      {/* Sitelinks — Google-style sub-page links */}
      {sitelinks.length >= 2 && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {sitelinks.slice(0, 6).map(sl => (
              <a key={sl.url} href={sl.url} target="_blank" rel="noreferrer"
                className="group/sl p-2 rounded-lg hover:bg-card2 transition-colors border border-transparent hover:border-border">
                <p className="text-blue text-xs font-medium group-hover/sl:underline capitalize truncate">
                  {slLabel(sl.url, sl.title)}
                </p>
                {sl.desc && (
                  <p className="text-muted text-[11px] leading-tight mt-0.5 line-clamp-2">{sl.desc}</p>
                )}
              </a>
            ))}
          </div>
          <p className="text-muted text-[11px] mt-2">
            More results from <a href={`https://${domain}`} target="_blank" rel="noreferrer"
              className="text-blue hover:underline">{domain}</a> »
          </p>
        </div>
      )}
    </motion.div>
  )
}
