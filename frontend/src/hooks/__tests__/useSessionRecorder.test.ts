import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  extensionForMime,
  pickMimeType,
  useSessionRecorder,
} from "../useSessionRecorder"
import type { UseSessionRecorderOptions } from "../useSessionRecorder"

const SUPPORTED_MIME = "video/webm;codecs=vp9"

/** Minimal MediaRecorder stand-in — jsdom has none. */
class MockMediaRecorder {
  static instances: MockMediaRecorder[] = []
  static isTypeSupported = vi.fn((t: string) => t === SUPPORTED_MIME)
  state: "inactive" | "recording" = "inactive"
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  start = vi.fn(() => {
    this.state = "recording"
  })
  stop = vi.fn(() => {
    this.state = "inactive"
    this.onstop?.()
  })
  constructor(
    public stream: MediaStream,
    public options?: { mimeType: string },
  ) {
    MockMediaRecorder.instances.push(this)
  }
}

interface CtxSpies {
  translate: ReturnType<typeof vi.fn>
  scale: ReturnType<typeof vi.fn>
  drawImage: ReturnType<typeof vi.fn>
}

let ctxSpies: CtxSpies

function makeCtx(): CanvasRenderingContext2D {
  ctxSpies = { translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn() }
  return {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    ...ctxSpies,
  } as unknown as CanvasRenderingContext2D
}

function fakeVideo(): React.RefObject<HTMLVideoElement> {
  const video = { videoWidth: 640, videoHeight: 480, readyState: 4 } as unknown as HTMLVideoElement
  return { current: video }
}

function options(overrides: Partial<UseSessionRecorderOptions> = {}): UseSessionRecorderOptions {
  return {
    videoRef: fakeVideo(),
    overlayCanvas: () => null,
    drawHud: vi.fn(),
    mirrored: false,
    exercise: "squat",
    ...overrides,
  }
}

beforeEach(() => {
  MockMediaRecorder.instances = []
  vi.stubGlobal("MediaRecorder", MockMediaRecorder)
  vi.stubGlobal("requestAnimationFrame", vi.fn((): number => 1))
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
  HTMLCanvasElement.prototype.captureStream = vi.fn(() => ({}) as MediaStream)
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => makeCtx() as unknown as RenderingContext,
  )
  URL.createObjectURL = vi.fn(() => "blob:mock")
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (navigator as { canShare?: unknown }).canShare
  delete (navigator as { share?: unknown }).share
})

describe("codec selection", () => {
  it("picks the first supported candidate", () => {
    expect(pickMimeType()).toBe(SUPPORTED_MIME)
  })

  it("derives the file extension from the mime type", () => {
    expect(extensionForMime("video/webm;codecs=vp9")).toBe("webm")
    expect(extensionForMime("video/mp4;codecs=h264")).toBe("mp4")
  })
})

describe("useSessionRecorder support detection", () => {
  it("is unsupported (button hidden) when MediaRecorder is missing", () => {
    vi.stubGlobal("MediaRecorder", undefined)
    const { result } = renderHook(() => useSessionRecorder(options()))
    expect(result.current.supported).toBe(false)
  })

  it("is supported when MediaRecorder, a codec, and captureStream exist", () => {
    const { result } = renderHook(() => useSessionRecorder(options()))
    expect(result.current.supported).toBe(true)
  })
})

describe("useSessionRecorder lifecycle", () => {
  it("start() flips to recording, builds a MediaRecorder, and drives the rAF loop", () => {
    const { result } = renderHook(() => useSessionRecorder(options()))
    act(() => result.current.start())
    expect(result.current.recording).toBe(true)
    expect(MockMediaRecorder.instances).toHaveLength(1)
    expect(MockMediaRecorder.instances[0].options?.mimeType).toBe(SUPPORTED_MIME)
    expect(MockMediaRecorder.instances[0].start).toHaveBeenCalled()
    expect(requestAnimationFrame).toHaveBeenCalled()
  })

  it("mirrors the compositor video draw when mirrored is set", () => {
    const { result } = renderHook(() => useSessionRecorder(options({ mirrored: true })))
    act(() => result.current.start())
    // start() paints the first frame synchronously, so the transform is applied.
    expect(ctxSpies.translate).toHaveBeenCalledWith(640, 0)
    expect(ctxSpies.scale).toHaveBeenCalledWith(-1, 1)
  })

  it("does not flip the draw when un-mirrored (back camera)", () => {
    const { result } = renderHook(() => useSessionRecorder(options({ mirrored: false })))
    act(() => result.current.start())
    expect(ctxSpies.scale).not.toHaveBeenCalledWith(-1, 1)
  })

  it("stop() flushes chunks to a Blob and saves via the download fallback", async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    const { result } = renderHook(() => useSessionRecorder(options()))
    act(() => result.current.start())

    const recorder = MockMediaRecorder.instances[0]
    act(() => recorder.ondataavailable?.({ data: new Blob(["x"], { type: SUPPORTED_MIME }) }))

    await act(async () => {
      result.current.stop()
      await Promise.resolve()
    })

    expect(recorder.stop).toHaveBeenCalled()
    expect(result.current.recording).toBe(false)
    await waitFor(() => expect(clickSpy).toHaveBeenCalled())
    expect(URL.createObjectURL).toHaveBeenCalled()
  })

  it("stop() prefers the native share sheet when canShare reports files are shareable", async () => {
    const share = vi.fn(() => Promise.resolve())
    ;(navigator as { canShare?: (d: unknown) => boolean }).canShare = vi.fn(() => true)
    ;(navigator as { share?: (d: unknown) => Promise<void> }).share = share

    const { result } = renderHook(() => useSessionRecorder(options()))
    act(() => result.current.start())
    const recorder = MockMediaRecorder.instances[0]
    act(() => recorder.ondataavailable?.({ data: new Blob(["x"], { type: SUPPORTED_MIME }) }))

    await act(async () => {
      result.current.stop()
      await Promise.resolve()
    })

    await waitFor(() => expect(share).toHaveBeenCalled())
  })

  it("stop() is a no-op when not recording (safe to call from auto-stop hooks)", () => {
    const { result } = renderHook(() => useSessionRecorder(options()))
    expect(() => act(() => result.current.stop())).not.toThrow()
    expect(MockMediaRecorder.instances).toHaveLength(0)
  })
})
