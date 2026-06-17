import { useEffect, useState } from "react"

import { apiJson } from "../lib/api"

export interface HistorySessionRow {
  readonly id: string
  readonly exercise: string
  readonly session_type?: string
  readonly rep_count: number
  readonly avg_form_score: number
  readonly started_at: string
  readonly ended_at: string | null
}

interface UseHistorySessionsResult {
  readonly sessions: readonly HistorySessionRow[]
  readonly loading: boolean
  /** False when the fetch failed (most commonly: signed out). */
  readonly authed: boolean
}

/**
 * One-shot fetch of the signed-in user's session history (newest first), shared
 * by the Home dashboard and (eventually) any other view that needs the raw list
 * rather than re-deriving it from a render prop.
 */
export function useHistorySessions(): UseHistorySessionsResult {
  const [sessions, setSessions] = useState<HistorySessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [authed, setAuthed] = useState(true)

  useEffect(() => {
    let cancelled = false
    void apiJson<HistorySessionRow[]>("/api/v1/history/sessions")
      .then((data) => {
        if (cancelled) return
        setSessions(data)
        setAuthed(true)
      })
      .catch(() => {
        if (!cancelled) setAuthed(false)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { sessions, loading, authed }
}
