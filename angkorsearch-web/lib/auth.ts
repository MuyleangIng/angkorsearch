import axios from 'axios'

// Separate axios instance for auth — sends cookies with every request
export const authHttp = axios.create({
  withCredentials: true,
  timeout: 15_000,
})

export interface User {
  id:             number
  email:          string
  username:       string
  avatar_url:     string
  bio:            string
  website:        string
  location:       string
  role:           'user' | 'admin'
  is_active:      boolean
  email_verified: boolean
  has_google:     boolean
  has_github:     boolean
  created_at:     string
}

export async function getMe(): Promise<User | null> {
  try {
    const { data } = await authHttp.get<User>('/auth/me')
    return data
  } catch {
    return null
  }
}

export async function login(email: string, password: string): Promise<User> {
  const { data } = await authHttp.post<User>('/auth/login', { email, password })
  return data
}

export async function register(email: string, username: string, password: string): Promise<User> {
  const { data } = await authHttp.post<User>('/auth/register', { email, username, password })
  return data
}

export async function logout(): Promise<void> {
  await authHttp.post('/auth/logout')
}

export async function updateProfile(profile: {
  username: string
  bio:      string
  website:  string
  location: string
}): Promise<void> {
  await authHttp.put('/auth/profile', profile)
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await authHttp.put('/auth/password', {
    current_password: currentPassword,
    new_password:     newPassword,
  })
}

export async function forgotPassword(email: string): Promise<void> {
  await authHttp.post('/auth/forgot-password', { email })
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await authHttp.post('/auth/reset-password', { token, new_password: newPassword })
}

export async function verifyEmail(token: string): Promise<void> {
  await authHttp.post('/auth/verify-email', { token })
}

export async function resendVerification(): Promise<void> {
  await authHttp.post('/auth/resend-verification')
}

export async function uploadAvatar(file: File): Promise<string> {
  const form = new FormData()
  form.append('avatar', file)
  const { data } = await authHttp.post<{ avatar_url: string }>('/auth/avatar', form)
  return data.avatar_url
}

export async function deleteAvatar(): Promise<void> {
  await authHttp.delete('/auth/avatar')
}

export async function deleteAccount(password?: string): Promise<void> {
  await authHttp.delete('/auth/account', { data: { password } })
}

export async function logoutAllDevices(): Promise<void> {
  await authHttp.post('/auth/logout-all')
}

// ─── Error helper ─────────────────────────────────────────────────────────────

export function getAuthError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return err.response?.data?.error ?? err.message
  }
  return 'An unexpected error occurred'
}
