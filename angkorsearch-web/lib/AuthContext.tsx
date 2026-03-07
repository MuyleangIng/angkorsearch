'use client'
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { getMe, logout as apiLogout, type User } from './auth'

interface AuthContextValue {
  user:    User | null
  loading: boolean
  refresh: () => Promise<void>
  logout:  () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  user:    null,
  loading: true,
  refresh: async () => {},
  logout:  async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const me = await getMe()
    setUser(me)
  }, [])

  const logout = useCallback(async () => {
    await apiLogout()
    setUser(null)
  }, [])

  useEffect(() => {
    getMe().then(me => {
      setUser(me)
      setLoading(false)
    })
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
