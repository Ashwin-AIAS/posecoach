import { useCallback, useEffect, useState } from "react"

import { apiFetch, apiJson } from "../lib/api"

export interface AuthUser {
  readonly id: string
  readonly email: string
  readonly created_at: string
}

export type AuthState = "loading" | "authenticated" | "anonymous"

interface UseAuthResult {
  readonly user: AuthUser | null
  readonly state: AuthState
  readonly error: string | null
  readonly login: (email: string, password: string) => Promise<void>
  readonly register: (email: string, password: string) => Promise<void>
  readonly logout: () => Promise<void>
  readonly deleteAccount: () => Promise<void>
}

/**
 * Tracks the current user via httpOnly cookies. Calls `/auth/me` on mount —
 * the apiFetch wrapper will silently refresh-then-retry if the access token
 * has already expired.
 */
export function useAuth(): UseAuthResult {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [state, setState] = useState<AuthState>("loading")
  const [error, setError] = useState<string | null>(null)

  const fetchMe = useCallback(async (): Promise<void> => {
    try {
      const me = await apiJson<AuthUser>("/api/v1/auth/me")
      setUser(me)
      setState("authenticated")
    } catch {
      setUser(null)
      setState("anonymous")
    }
  }, [])

  useEffect(() => {
    void fetchMe()
  }, [fetchMe])

  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      setError(null)
      try {
        const me = await apiJson<AuthUser>("/api/v1/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        })
        setUser(me)
        setState("authenticated")
      } catch (e) {
        setError((e as Error).message)
        throw e
      }
    },
    [],
  )

  const register = useCallback(
    async (email: string, password: string): Promise<void> => {
      setError(null)
      try {
        const me = await apiJson<AuthUser>("/api/v1/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        })
        setUser(me)
        setState("authenticated")
      } catch (e) {
        setError((e as Error).message)
        throw e
      }
    },
    [],
  )

  const logout = useCallback(async (): Promise<void> => {
    await apiFetch("/api/v1/auth/logout", { method: "POST" })
    setUser(null)
    setState("anonymous")
  }, [])

  const deleteAccount = useCallback(async (): Promise<void> => {
    await apiFetch("/api/v1/auth/account", { method: "DELETE" })
    setUser(null)
    setState("anonymous")
  }, [])

  return { user, state, error, login, register, logout, deleteAccount }
}
