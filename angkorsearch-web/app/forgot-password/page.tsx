'use client'
import { useState } from 'react'
import Link from 'next/link'
import { forgotPassword, getAuthError } from '@/lib/auth'

export default function ForgotPasswordPage() {
  const [email,   setEmail]   = useState('')
  const [sent,    setSent]    = useState(false)
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await forgotPassword(email)
      setSent(true)
    } catch (err) {
      setError(getAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-primary flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/">
            <img src="/logo.png" alt="AngkorSearch" className="h-14 w-auto mx-auto mb-4" />
          </Link>
          <h1 className="text-xl font-bold text-content">Forgot your password?</h1>
          <p className="text-muted text-sm mt-1">We&apos;ll send a reset link to your email.</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
          {sent ? (
            <div className="text-center">
              <div className="text-4xl mb-4">📨</div>
              <h2 className="text-base font-bold text-content mb-2">Check your inbox</h2>
              <p className="text-muted text-sm">
                If <strong className="text-content">{email}</strong> is registered, you will receive a reset link shortly.
              </p>
              <p className="text-muted text-xs mt-3">Check your spam folder if you don&apos;t see it.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <div className="bg-red/10 border border-red/30 text-red text-sm rounded-xl px-4 py-3">
                  {error}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full bg-card2 border border-border rounded-xl px-4 py-2.5 text-content text-sm focus:outline-none focus:border-blue transition-colors"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue text-white rounded-xl py-2.5 font-semibold text-sm hover:bg-blue/90 transition-colors disabled:opacity-60"
              >
                {loading ? 'Sending…' : 'Send Reset Link'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-muted text-sm mt-6">
          <Link href="/login" className="text-blue hover:underline">
            ← Back to sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
