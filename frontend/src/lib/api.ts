/**
 * Fetch wrapper with automatic refresh-token rotation on 401.
 *
 * Cookies are httpOnly so we never read tokens in JS — credentials: "include"
 * lets the browser carry them. On a 401 we POST /api/v1/auth/refresh once; if
 * that succeeds the original request is retried; otherwise the error bubbles.
 */

import type { EffortRating, PrepCycle, PrepProgress, Recommendation } from "../types"

const BASE_URL = (import.meta.env.VITE_API_URL as string) || ""
const REFRESH_PATH = `${BASE_URL}/api/v1/auth/refresh`

let pendingRefresh: Promise<boolean> | null = null

async function refreshOnce(): Promise<boolean> {
  if (!pendingRefresh) {
    pendingRefresh = fetch(REFRESH_PATH, {
      method: "POST",
      credentials: "include",
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        // Allow another refresh attempt on the next 401
        setTimeout(() => {
          pendingRefresh = null
        }, 0)
      })
  }
  return pendingRefresh
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const targetUrl = input.startsWith("http") ? input : `${BASE_URL}${input}`
  const opts: RequestInit = {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  }

  let resp = await fetch(targetUrl, opts)
  if (resp.status !== 401 || targetUrl.endsWith(REFRESH_PATH)) return resp

  const refreshed = await refreshOnce()
  if (!refreshed) return resp

  resp = await fetch(targetUrl, opts)
  return resp
}

/** Save the 1-tap effort rating for a finished session (P16). */
export async function submitEffort(sessionId: string, effort: EffortRating): Promise<void> {
  await apiJson<unknown>(`/api/v1/history/sessions/${sessionId}/feedback`, {
    method: "PATCH",
    body: JSON.stringify({ effort }),
  })
}

/**
 * Fetch the adaptive coach's next-session recommendation (P16).
 * Returns null on cold start (204), when signed out, or on any error —
 * the card simply doesn't render.
 */
export async function fetchRecommendation(exercise: string): Promise<Recommendation | null> {
  try {
    const resp = await apiFetch(
      `/api/v1/history/recommendation?exercise=${encodeURIComponent(exercise)}`,
    )
    if (resp.status === 204 || !resp.ok) return null
    return (await resp.json()) as Recommendation
  } catch {
    return null
  }
}

/** List the signed-in user's contest-prep cycles, newest first (P17). */
export async function fetchPreps(): Promise<PrepCycle[]> {
  return apiJson<PrepCycle[]>("/api/v1/history/preps")
}

/** Create a contest-prep cycle (P17). `showDate` is an ISO yyyy-mm-dd or null. */
export async function createPrep(name: string, showDate: string | null): Promise<PrepCycle> {
  return apiJson<PrepCycle>("/api/v1/history/preps", {
    method: "POST",
    body: JSON.stringify({ name, show_date: showDate }),
  })
}

/** Fetch the per-pose symmetry & hold-steadiness progress for a prep (P18). */
export async function fetchPrepProgress(prepId: string): Promise<PrepProgress> {
  return apiJson<PrepProgress>(`/api/v1/history/preps/${prepId}/progress`)
}

/** Tag (or, with prepId=null, untag) a session to a prep cycle (P17). */
export async function assignSessionPrep(sessionId: string, prepId: string | null): Promise<void> {
  await apiJson<unknown>(`/api/v1/history/sessions/${sessionId}/prep`, {
    method: "PATCH",
    body: JSON.stringify({ prep_id: prepId }),
  })
}

/** A single periodic snapshot persisted during a session (score + raw keypoints). */
export interface SessionSnapshot {
  readonly ts: number
  readonly score: number
}

/** Full detail for one session — the `/history/sessions` list row plus its snapshot timeline. */
export interface SessionDetail {
  readonly id: string
  readonly exercise: string
  readonly session_type?: string
  readonly rep_count: number
  readonly avg_form_score: number
  readonly started_at: string
  readonly ended_at: string | null
  readonly keypoints_data: { snapshots?: readonly SessionSnapshot[] }
}

/** Fetch one session's full detail, including its in-session score snapshots (UI-06 tap-in detail). */
export async function getSessionDetail(sessionId: string): Promise<SessionDetail> {
  return apiJson<SessionDetail>(`/api/v1/history/sessions/${sessionId}`)
}

export async function apiJson<T>(input: string, init: RequestInit = {}): Promise<T> {
  const resp = await apiFetch(input, init)
  if (!resp.ok) {
    let detail = `Request failed (${resp.status})`
    try {
      const body = (await resp.json()) as { detail?: string }
      if (body.detail) detail = body.detail
    } catch {
      // fall through with default message
    }
    throw new Error(detail)
  }
  return (await resp.json()) as T
}
