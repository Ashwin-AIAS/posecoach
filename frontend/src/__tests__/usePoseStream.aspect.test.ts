import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { usePoseStream } from "../hooks/usePoseStream"

/**
 * Guards docs/enhancements/FIX_BACK_CAMERA_POSE_QUALITY.md Phase 2: the
 * capture canvas must match the video's true aspect ratio instead of
 * squishing a 16:9 back-camera frame into a hardcoded 4:3 box.
 */

class MockWebSocket {
  static OPEN = 1
  url: string
  readyState = 0
  constructor(url: string) {
    this.url = url
  }
  addEventListener(): void {}
  send(): void {}
  close(): void {}
}

let rafCallbacks: FrameRequestCallback[]

function flushRaf(time = 100): void {
  const cbs = rafCallbacks
  rafCallbacks = []
  cbs.forEach((cb) => cb(time))
}

function makeFakeVideo(videoWidth: number, videoHeight: number): HTMLVideoElement {
  return { readyState: 4, videoWidth, videoHeight } as unknown as HTMLVideoElement
}

let drawImageSpy: ReturnType<typeof vi.fn>
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext
let originalToDataURL: typeof HTMLCanvasElement.prototype.toDataURL

beforeEach(() => {
  vi.stubGlobal("WebSocket", MockWebSocket)

  rafCallbacks = []
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafCallbacks.push(cb)
    return rafCallbacks.length
  })
  vi.stubGlobal("cancelAnimationFrame", () => {})

  drawImageSpy = vi.fn()
  originalGetContext = HTMLCanvasElement.prototype.getContext
  originalToDataURL = HTMLCanvasElement.prototype.toDataURL
  // jsdom has no real canvas backend — stub just enough for capture to run.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: drawImageSpy,
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.toDataURL = vi.fn(
    () => "data:image/jpeg;base64,AAAA",
  ) as unknown as typeof HTMLCanvasElement.prototype.toDataURL
})

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext
  HTMLCanvasElement.prototype.toDataURL = originalToDataURL
  vi.unstubAllGlobals()
})

describe("usePoseStream aspect-correct capture", () => {
  it("sizes the capture canvas to a 16:9 video's true aspect, not a squished 4:3 box", () => {
    const videoRef = { current: makeFakeVideo(1280, 720) }
    renderHook(() => usePoseStream({ videoRef, exercise: "squat", active: true }))

    flushRaf() // run one capture loop tick

    // Exactly one main-canvas draw: the low-light luma probe (FIX_POSE_TRACKING
    // Phase 5) skips itself when getImageData is unavailable (jsdom), so it never
    // adds a phantom drawImage here.
    expect(drawImageSpy).toHaveBeenCalledTimes(1)
    const [, , , cw, ch] = drawImageSpy.mock.calls[0] as [unknown, number, number, number, number]
    // Long side raised 384 -> 512 (Phase 2), aspect preserved: 1280x720 -> 512x288.
    expect(cw).toBe(512)
    expect(ch).toBe(288)
  })

  it("sizes the capture canvas to a 4:3 video's true aspect", () => {
    const videoRef = { current: makeFakeVideo(640, 480) }
    renderHook(() => usePoseStream({ videoRef, exercise: "squat", active: true }))

    flushRaf()

    const [, , , cw, ch] = drawImageSpy.mock.calls[0] as [unknown, number, number, number, number]
    // 640x480 at long-side 512, aspect preserved -> 512x384.
    expect(cw).toBe(512)
    expect(ch).toBe(384)
  })
})
