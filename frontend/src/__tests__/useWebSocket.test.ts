import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useWebSocket } from "../hooks/useWebSocket"
import type { ServerMessage } from "../types"

class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static instances: MockWebSocket[] = []

  readyState = 0
  url: string
  private listeners = new Map<string, Array<(ev: unknown) => void>>()

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: (ev: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type)?.push(listener)
  }

  send(_data: string): void {
    void _data
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED
    this.dispatch("close", {})
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN
    this.dispatch("open", {})
  }

  receive(data: string): void {
    this.dispatch("message", { data })
  }

  private dispatch(type: string, event: object): void {
    this.listeners.get(type)?.forEach((l) => l(event))
  }
}

let originalWS: typeof WebSocket

beforeEach(() => {
  originalWS = globalThis.WebSocket
  // @ts-expect-error mock
  globalThis.WebSocket = MockWebSocket
  // @ts-expect-error mock constants used by hook
  globalThis.WebSocket.OPEN = MockWebSocket.OPEN
  MockWebSocket.instances = []
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  globalThis.WebSocket = originalWS
})

describe("useWebSocket", () => {
  it("transitions through states on connect → open", () => {
    const onMessage = vi.fn()
    const { result } = renderHook(() =>
      useWebSocket({ url: "ws://localhost/test", onMessage }),
    )
    expect(result.current.state).toBe("connecting")

    act(() => {
      MockWebSocket.instances[0]?.open()
    })
    expect(result.current.state).toBe("open")
  })

  it("invokes onMessage with parsed JSON payload", () => {
    const onMessage = vi.fn()
    renderHook(() => useWebSocket({ url: "ws://localhost/test", onMessage }))
    act(() => {
      MockWebSocket.instances[0]?.open()
    })

    const payload: ServerMessage = {
      keypoints: [],
      confidence: [],
      score: 90,
      cues: [],
      latency_ms: 50,
    }
    act(() => {
      MockWebSocket.instances[0]?.receive(JSON.stringify(payload))
    })

    expect(onMessage).toHaveBeenCalledWith(payload)
  })

  it("does NOT crash on malformed JSON", () => {
    const onMessage = vi.fn()
    renderHook(() => useWebSocket({ url: "ws://localhost/test", onMessage }))
    act(() => {
      MockWebSocket.instances[0]?.open()
      MockWebSocket.instances[0]?.receive("{ malformed")
    })
    expect(onMessage).not.toHaveBeenCalled()
  })

  it("retries with exponential backoff on close", () => {
    const onMessage = vi.fn()
    renderHook(() => useWebSocket({ url: "ws://localhost/test", onMessage }))

    expect(MockWebSocket.instances).toHaveLength(1)
    act(() => {
      MockWebSocket.instances[0]?.open()
      MockWebSocket.instances[0]?.close()
    })

    // first backoff = 1000ms
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it("disconnect halts reconnection", () => {
    const onMessage = vi.fn()
    const { result } = renderHook(() =>
      useWebSocket({ url: "ws://localhost/test", onMessage }),
    )
    act(() => {
      MockWebSocket.instances[0]?.open()
      result.current.disconnect()
    })
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it("send returns false when socket is not OPEN", () => {
    const onMessage = vi.fn()
    const { result } = renderHook(() =>
      useWebSocket({ url: "ws://localhost/test", onMessage }),
    )
    expect(result.current.send({ frame: "x", exercise: "squat" })).toBe(false)
  })

  it("send returns true when socket is OPEN", () => {
    const onMessage = vi.fn()
    const { result } = renderHook(() =>
      useWebSocket({ url: "ws://localhost/test", onMessage }),
    )
    act(() => {
      MockWebSocket.instances[0]?.open()
    })
    expect(result.current.send({ frame: "x", exercise: "squat" })).toBe(true)
  })
})

describe("localStorage usage audit", () => {
  it("never touches localStorage during a connection lifecycle", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem")
    renderHook(() =>
      useWebSocket({ url: "ws://localhost/test", onMessage: vi.fn() }),
    )
    act(() => {
      MockWebSocket.instances[0]?.open()
    })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
