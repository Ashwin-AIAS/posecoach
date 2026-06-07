import { useCallback, useRef, useState } from "react"

import type { Exercise } from "../types"

export type ChatRole = "user" | "assistant"
export type SourceMode = "rag" | "web" | "conversational" | "none"

/** ES2020-compatible findLastIndex. */
function findLastIndex<T>(arr: readonly T[], pred: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i
  }
  return -1
}

export interface ChatMessage {
  readonly id: string
  readonly role: ChatRole
  readonly text: string
  readonly hasFrame: boolean
  /** How this answer was grounded (only set on assistant messages). */
  readonly sourceMode?: SourceMode
  /** User feedback on this response. */
  feedback?: "up" | "down" | null
}

export type ChatState = "idle" | "thinking" | "streaming" | "error"

interface UseChatOptions {
  readonly endpoint?: string
}

interface SendOptions {
  readonly query: string
  readonly exercise?: Exercise
  readonly frame?: string | null
}

interface UseChatResult {
  readonly messages: readonly ChatMessage[]
  readonly state: ChatState
  readonly error: string | null
  readonly send: (opts: SendOptions) => Promise<void>
  readonly cancel: () => void
  /** Re-send the last user message for a fresh response. */
  readonly regenerate: () => Promise<void>
  /** Set feedback (thumbs up/down) on a specific message. */
  readonly setFeedback: (messageId: string, value: "up" | "down" | null) => void
}

function getDefaultEndpoint(): string {
  const envUrl = (import.meta.env.VITE_API_URL as string) || ""
  if (envUrl) {
    return `${envUrl}/api/v1/chat/stream`
  }
  if (typeof window === "undefined") return "http://localhost:8000/api/v1/chat/stream"
  return `${window.location.protocol}//${window.location.host}/api/v1/chat/stream`
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Maximum conversation turns to send as history (3 exchanges = 6 messages). */
const MAX_HISTORY_MESSAGES = 6

/**
 * SSE chat hook. POSTs the query (+ optional frame + history) and parses
 * the ``data: {...}\n\n`` stream into incremental assistant tokens, with
 * support for status/meta events from the modernized backend.
 */
export function useChat(opts: UseChatOptions = {}): UseChatResult {
  const endpoint = opts.endpoint ?? getDefaultEndpoint()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [state, setState] = useState<ChatState>("idle")
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  // Keep a ref to the last send options for regenerate
  const lastSendRef = useRef<SendOptions | null>(null)

  const appendToken = useCallback((assistantId: string, token: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + token } : m)),
    )
  }, [])

  const setSourceMode = useCallback((assistantId: string, mode: SourceMode) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === assistantId ? { ...m, sourceMode: mode } : m)),
    )
  }, [])

  const send = useCallback(
    async ({ query, exercise, frame }: SendOptions): Promise<void> => {
      const trimmed = query.trim()
      if (!trimmed || state === "streaming" || state === "thinking") return

      lastSendRef.current = { query: trimmed, exercise, frame }

      const userMsg: ChatMessage = {
        id: makeId(),
        role: "user",
        text: trimmed,
        hasFrame: Boolean(frame),
        feedback: null,
      }
      const assistantMsg: ChatMessage = {
        id: makeId(),
        role: "assistant",
        text: "",
        hasFrame: false,
        feedback: null,
      }

      setMessages((prev) => {
        const updated = [...prev, userMsg, assistantMsg]
        return updated
      })
      setState("thinking")
      setError(null)

      const controller = new AbortController()
      controllerRef.current = controller

      // Build history from existing messages (last N, excluding the ones we just added)
      const historyMessages = messages
        .slice(-MAX_HISTORY_MESSAGES)
        .filter((m) => m.text.trim())
        .map((m) => ({ role: m.role, content: m.text }))

      try {
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          credentials: "include",
          body: JSON.stringify({
            query: trimmed,
            ...(exercise ? { exercise } : {}),
            ...(frame ? { frame } : {}),
            ...(historyMessages.length > 0 ? { history: historyMessages } : {}),
          }),
          signal: controller.signal,
        })

        if (!resp.ok || !resp.body) {
          throw new Error(`Server returned ${resp.status}`)
        }

        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        let done = false

        while (!done) {
          const { value, done: streamDone } = await reader.read()
          if (streamDone) break
          buffer += decoder.decode(value, { stream: true })
          const events = buffer.split("\n\n")
          buffer = events.pop() ?? ""
          for (const evt of events) {
            const line = evt.trim()
            if (!line.startsWith("data:")) continue
            const payload = line.slice(5).trim()
            try {
              const parsed = JSON.parse(payload) as Record<string, unknown>

              // Handle new event types
              if (parsed.type === "status") {
                // Status event (e.g. "thinking") — no action needed, we're already
                // in "thinking" state; this confirms the backend received us
                continue
              }
              if (parsed.type === "meta") {
                // Source mode metadata
                const mode = parsed.source_mode as SourceMode | undefined
                if (mode) {
                  setSourceMode(assistantMsg.id, mode)
                }
                continue
              }

              // Standard token event
              if (parsed.done) {
                done = true
                break
              }
              if (parsed.token) {
                // Transition from "thinking" to "streaming" on first token
                setState((s) => (s === "thinking" ? "streaming" : s))
                appendToken(assistantMsg.id, parsed.token as string)
              }
            } catch {
              // Ignore malformed events — server controls format
            }
          }
        }
        setState("idle")
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setState("idle")
          return
        }
        const msg = (e as Error).message ?? "Chat failed"
        setError(msg)
        setState("error")
      } finally {
        controllerRef.current = null
      }
    },
    [appendToken, endpoint, messages, setSourceMode, state],
  )

  const cancel = useCallback(() => {
    controllerRef.current?.abort()
  }, [])

  const regenerate = useCallback(async () => {
    if (!lastSendRef.current) return
    // Remove the last assistant message so it gets replaced
    setMessages((prev) => {
      // Find the last assistant message and the user message before it
      const lastAssistantIdx = findLastIndex(prev, (m) => m.role === "assistant")
      const lastUserIdx = findLastIndex(prev, (m) => m.role === "user")
      if (lastAssistantIdx === -1 || lastUserIdx === -1) return prev
      // Remove both — send() will re-add them
      return prev.slice(0, lastUserIdx)
    })
    // Re-send the last query
    await send(lastSendRef.current)
  }, [send])

  const setFeedback = useCallback((messageId: string, value: "up" | "down" | null) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, feedback: value } : m)),
    )
  }, [])

  return { messages, state, error, send, cancel, regenerate, setFeedback }
}
