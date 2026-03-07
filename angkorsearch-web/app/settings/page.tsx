'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Settings are part of the Profile page — redirect there
export default function SettingsRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/profile?tab=settings') }, [router])
  return null
}
