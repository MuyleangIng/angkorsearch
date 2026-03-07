'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { verifyEmail, resendVerification, getAuthError } from '@/lib/auth'
import { useAuth } from '@/lib/AuthContext'

export default function VerifyEmailPage() {
  const params     = useSearchParams()
  const { user, refresh } = useAuth()

  const token   = params.get('token')
  const success = params.get('success')
  const errParam = params.get('error')

  const [status,  setStatus]  = useState<'idle' | 'verifying' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [resent,  setResent]  = useState(false)
  const [resending, setResending] = useState(false)

  useEffect(() => {
    if (success === 'true') {
      setStatus('success')
      refresh()
      return
    }
    if (errParam) {
      setStatus('error')
      setMessage(errParam === 'invalid_token'
        ? 'This verification link is invalid or has expired.'
        : 'Something went wrong. Please try again.')
      return
    }
    if (token) {
      setStatus('verifying')
      verifyEmail(token)
        .then(() => { setStatus('success'); refresh() })
        .catch(err  => { setStatus('error'); setMessage(getAuthError(err)) })
    }
  }, [token, success, errParam, refresh])

  async function handleResend() {
    setResending(true)
    try {
      await resendVerification()
      setResent(true)
    } catch (err) {
      setMessage(getAuthError(err))
    } finally {
      setResending(false)
    }
  }

  return (
    <main className="min-h-screen bg-primary flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <Link href="/">
          <img src="/logo.png" alt="AngkorSearch" className="h-14 w-auto mx-auto mb-8" />
        </Link>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
          {status === 'idle' && (
            <>
              <div className="text-4xl mb-4">📧</div>
              <h1 className="text-lg font-bold text-content mb-2">Verify your email</h1>
              <p className="text-muted text-sm">
                We sent a verification link to your email address. Click the link to activate your account.
              </p>
              {user && !user.email_verified && (
                <div className="mt-6">
                  {resent ? (
                    <p className="text-sm text-blue">Verification email sent! Check your inbox.</p>
                  ) : (
                    <button
                      onClick={handleResend}
                      disabled={resending}
                      className="text-sm text-blue hover:underline disabled:opacity-60"
                    >
                      {resending ? 'Sending…' : 'Resend verification email'}
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {status === 'verifying' && (
            <>
              <div className="text-4xl mb-4">⏳</div>
              <h1 className="text-lg font-bold text-content">Verifying your email…</h1>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="text-4xl mb-4">✅</div>
              <h1 className="text-lg font-bold text-content mb-2">Email verified!</h1>
              <p className="text-muted text-sm mb-6">Your account is now fully active.</p>
              <Link
                href="/"
                className="inline-block bg-blue text-white rounded-xl px-6 py-2.5 text-sm font-semibold hover:bg-blue/90 transition-colors"
              >
                Go to AngkorSearch
              </Link>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="text-4xl mb-4">❌</div>
              <h1 className="text-lg font-bold text-content mb-2">Verification failed</h1>
              <p className="text-muted text-sm mb-4">{message}</p>
              {user && !user.email_verified && (
                <button
                  onClick={handleResend}
                  disabled={resending}
                  className="text-sm text-blue hover:underline disabled:opacity-60"
                >
                  {resending ? 'Sending…' : 'Send a new verification link'}
                </button>
              )}
              {!user && (
                <Link href="/login" className="text-sm text-blue hover:underline">
                  Back to login
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  )
}
