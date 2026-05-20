import { useCallback, useEffect, useRef, useState } from "react"

import type { ConnectionState, ServerMessage } from "../types"

interface UseWebSocketOptions {
  readonly url: string
  readonly onMessage: (msg: ServerMessage) => void
  readonly autoConnect?: boolean
}

interface UseWebSocketResult {
  readonly state: ConnectionState
  readonly send: (data: object) => boolean
  readonly disconnect: () => void
  readonly connect: () => void
}

const BACKOFF_SCHEDULE_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const

/**
 * WebSocket client with exponential-backoff reconnection.
 * NEVER stores tokens or session data — auth handled by httpOnly cookies.
 */
export function useWebSocket(opts: UseWebSocketOptions): UseWebSocketResult {
  const { url, onMessage, autoConnect = true } = opts
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptRef = useRef(0)
  const shouldReconnectRef = useRef(true)
  const reconnectTimerRef = useRef<number | null>(null)
  const onMessageRef = useRef(onMessage)
  const [state, setState] = useState<ConnectionState>("idle")

  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return

    setState("connecting")
    shouldReconnectRef.current = true

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.addEventListener("open", () => {
      reconnectAttemptRef.current = 0
      setState("open")
    })

    ws.addEventListener("message", (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as ServerMessage
        onMessageRef.current(data)
      } catch {
        // malformed payload — drop silently to keep the stream alive
      }
    })

    ws.addEventListener("error", () => {
      setState("error")
    })

    ws.addEventListener("close", () => {
      wsRef.current = null
      setState("closed")
      if (!shouldReconnectRef.current) return
      const attempt = reconnectAttemptRef.current
      const delayMs =
        BACKOFF_SCHEDULE_MS[Math.min(attempt, BACKOFF_SCHEDULE_MS.length - 1)]
      reconnectAttemptRef.current = attempt + 1
      reconnectTimerRef.current = window.setTimeout(connect, delayMs)
    })
  }, [url])

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    wsRef.current?.close()
    wsRef.current = null
    setState("closed")
  }, [])

  const send = useCallback((data: object): boolean => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify(data))
    return true
  }, [])

  useEffect(() => {
    if (autoConnect) connect()
    return () => {
      disconnect()
    }
  }, [autoConnect, connect, disconnect])

  return { state, send, disconnect, connect }
}
