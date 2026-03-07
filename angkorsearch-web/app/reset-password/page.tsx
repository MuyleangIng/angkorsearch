'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { resetPassword, getAuthError } from '@/lib/auth'

export default function ResetPasswordPage() {
  const router  = useRouter()
  const params  = useSearchParams()
  const token   = params.get('token') ?? ''

  const [password,  setPassword]  = useState('')
  const [password2, setPassword2] = useState('')
  const [error,     setError]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [done,      setDone]      = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!token)                  { setError('Invalid reset link. Request a new one.'); return }
    if (password.length < 8)    { setError('Password must be at least 8 characters'); return }
    if (password !== password2) { setError('Passwords do not match'); return }

    setLoading(true)
    try {
      await resetPassword(token, password)
      setDone(true)
      setTimeout(() => router.push('/login'), 3000)
    } catch (err) {
      setError(getAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <main className="min-h-screen bg-primary flex items-center justify-center px-4">
        <div className="bg-card border border-border rounded-2xl p-8 text-center max-w-md w-full">
          <div className="text-4xl mb-4">⚠️</div>
          <h1 className="text-lg font-bold text-content mb-2">Invalid link</h1>
          <p className="text-muted text-sm mb-6">This reset link is missing or invalid.</p>
          <Link href="/forgot-password" className="text-blue hover:underline text-sm">
            Request a new reset link
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-primary flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/">
            <img src="/logo.png" alt="AngkorSearch" className="h-14 w-auto mx-auto mb-4" />
          </Link>
          <h1 className="text-xl font-bold text-content">Set a new password</h1>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
          {done ? (
            <div className="text-center">
              <div className="text-4xl mb-4">✅</div>
              <h2 className="text-base font-bold text-content mb-2">Password changed!</h2>
              <p className="text-muted text-sm">Redirecting you to login…</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <div className="bg-red/10 border border-red/30 text-red text-sm rounded-xl px-4 py-3">
                  {error}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">New Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  className="w-full bg-card2 border border-border rounded-xl px-4 py-2.5 text-content text-sm focus:outline-none focus:border-blue transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">Confirm New Password</label>
                <input
                  type="password"
                  value={password2}
                  onChange={e => setPassword2(e.target.value)}
                  placeholder="Re-enter password"
                  required
                  className="w-full bg-card2 border border-border rounded-xl px-4 py-2.5 text-content text-sm focus:outline-none focus:border-blue transition-colors"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue text-white rounded-xl py-2.5 font-semibold text-sm hover:bg-blue/90 transition-colors disabled:opacity-60"
              >
                {loading ? 'Saving…' : 'Set New Password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}
