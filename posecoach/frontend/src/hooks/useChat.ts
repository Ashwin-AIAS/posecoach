import { useCallback, useRef, useState } from "react"

import type { Exercise } from "../types"

export type ChatRole = "user" | "assistant"

export interface ChatMessage {
  readonly id: string
  readonly role: ChatRole
  readonly text: string
  readonly hasFrame: boolean
}

export type ChatState = "idle" | "streaming" | "error"

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
}

function getDefaultEndpoint(): string {
  if (typeof window === "undefined") return "http://localhost:8000/api/v1/chat/stream"
  return `${window.location.protocol}//${window.location.host}/api/v1/chat/stream`
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

interface SsePayload {
  readonly token: string
  readonly done: boolean
}

/**
 * SSE chat hook. POSTs the query (+ optional frame) and parses the
 * ``data: {...}\n\n`` stream into incremental assistant tokens.
 */
export function useChat(opts: UseChatOptions = {}): UseChatResult {
  const endpoint = opts.endpoint ?? getDefaultEndpoint()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [state, setState] = useState<ChatState>("idle")
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const appendToken = useCallback((assistantId: string, token: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + token } : m)),
    )
  }, [])

  const send = useCallback(
    async ({ query, exercise, frame }: SendOptions): Promise<void> => {
      const trimmed = query.trim()
      if (!trimmed || state === "streaming") return

      const userMsg: ChatMessage = {
        id: makeId(),
        role: "user",
        text: trimmed,
        hasFrame: Boolean(frame),
      }
      const assistantMsg: ChatMessage = {
        id: makeId(),
        role: "assistant",
        text: "",
        hasFrame: false,
      }
      setMessages((prev) => [...prev, userMsg, assistantMsg])
      setState("streaming")
      setError(null)

      const controller = new AbortController()
      controllerRef.current = controller

      try {
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          credentials: "include",
          body: JSON.stringify({
            query: trimmed,
            ...(exercise ? { exercise } : {}),
            ...(frame ? { frame } : {}),
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
              const parsed = JSON.parse(payload) as SsePayload
              if (parsed.done) {
                done = true
                break
              }
              if (parsed.token) appendToken(assistantMsg.id, parsed.token)
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
    [appendToken, endpoint, state],
  )

  const cancel = useCallback(() => {
    controllerRef.current?.abort()
  }, [])

  return { messages, state, error, send, cancel }
}
