/**
 * Fetch wrapper with automatic refresh-token rotation on 401.
 *
 * Cookies are httpOnly so we never read tokens in JS — credentials: "include"
 * lets the browser carry them. On a 401 we POST /api/v1/auth/refresh once; if
 * that succeeds the original request is retried; otherwise the error bubbles.
 */

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
