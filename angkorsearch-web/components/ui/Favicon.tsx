'use client'
import { useState } from 'react'
import { getFaviconUrl } from '@/lib/utils'

interface Props {
  domain: string
  size?: number
}

export default function Favicon({ domain, size = 16 }: Props) {
  const [error, setError] = useState(false)

  if (!domain || error) {
    return (
      <span style={{ fontSize: size, lineHeight: 1 }} aria-hidden>🌐</span>
    )
  }

  return (
    <img
      src={getFaviconUrl(domain)}
      width={size}
      height={size}
      alt=""
      style={{ borderRadius: 3, objectFit: 'contain', flexShrink: 0 }}
      onError={() => setError(true)}
    />
  )
}
