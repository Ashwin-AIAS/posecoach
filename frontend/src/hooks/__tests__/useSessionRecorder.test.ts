import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  extensionForMime,
  pickMimeType,
  useSessionRecorder,
} from "../useSessionRecorder"
import type { UseSessionRecorderOptions } from "../useSessionRecorder"

/**
 * The mp4 candidates are now first in MIME_CANDIDATES. We tell the mock to
 * support "video/mp4;codecs=h264" so tests pick the new preferred codec.
 * We also support "video/webm;codecs=vp9" as the webm fallback path.
 */
const SUPPORTED_MP4 = "video/mp4;codecs=h264"
const SUPPORTED_WEBM = "video/webm;codecs=vp9"

/** Minimal MediaRecorder stand-in — jsdom has none. */
class MockMediaRecorder {
  static instances: MockMediaRecorder[] = []
  static isTypeSupported = vi.fn(
    (t: string) => t === SUPPORTED_MP4 || t === SUPPORTED_WEBM,
  )
  state: "inactive" | "recording" = "inactive"
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  requestData = vi.fn(() => {
    // Simulate flushing data — fire ondataavailable with any pending data.
    // In tests we manually fire ondataavailable, so this is a no-op.
  })
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
  MockMediaRecorder.isTypeSupported = vi.fn(
    (t: string) => t === SUPPORTED_MP4 || t === SUPPORTED_WEBM,
  )
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
  it("picks mp4 first when supported (iOS)", () => {
    expect(pickMimeType()).toBe(SUPPORTED_MP4)
  })

  it("falls back to webm when mp4 is not supported", () => {
    MockMediaRecorder.isTypeSupported = vi.fn((t: string) => t === SUPPORTED_WEBM)
    expect(pickMimeType()).toBe(SUPPORTED_WEBM)
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
    expect(MockMediaRecorder.instances[0].options?.mimeType).toBe(SUPPORTED_MP4)
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

  it("stop() sets lastRecording with the recorded blob for in-app preview", async () => {
    const { result } = renderHook(() => useSessionRecorder(options()))
    act(() => result.current.start())

    const recorder = MockMediaRecorder.instances[0]
    act(() => recorder.ondataavailable?.({ data: new Blob(["x"], { type: SUPPORTED_MP4 }) }))

    // stop() defers finalize via Promise.resolve().then() — need async act.
    await act(async () => {
      result.current.stop()
      await Promise.resolve()
    })

    expect(recorder.stop).toHaveBeenCalled()
    expect(result.current.recording).toBe(false)
    expect(result.current.lastRecording).not.toBeNull()
    expect(result.current.lastRecording?.blob).toBeInstanceOf(Blob)
    expect(result.current.lastRecording?.mimeType).toBe(SUPPORTED_MP4)
    expect(result.current.lastRecording?.fileName).toMatch(/^posecoach-squat-\d+\.mp4$/)
  })

  it("clearRecording() dismisses the recording", async () => {
    const { result } = renderHook(() => useSessionRecorder(options()))
    act(() => result.current.start())

    const recorder = MockMediaRecorder.instances[0]
    act(() => recorder.ondataavailable?.({ data: new Blob(["x"], { type: SUPPORTED_MP4 }) }))

    await act(async () => {
      result.current.stop()
      await Promise.resolve()
    })
    expect(result.current.lastRecording).not.toBeNull()

    act(() => result.current.clearRecording())
    expect(result.current.lastRecording).toBeNull()
  })

  it("start() clears previous recording", async () => {
    const { result } = renderHook(() => useSessionRecorder(options()))

    // First recording
    act(() => result.current.start())
    const recorder1 = MockMediaRecorder.instances[0]
    act(() => recorder1.ondataavailable?.({ data: new Blob(["x"], { type: SUPPORTED_MP4 }) }))
    await act(async () => {
      result.current.stop()
      await Promise.resolve()
    })
    expect(result.current.lastRecording).not.toBeNull()

    // Start new recording — should clear previous
    act(() => result.current.start())
    expect(result.current.lastRecording).toBeNull()
  })

  it("stop() is a no-op when not recording (safe to call from auto-stop hooks)", () => {
    const { result } = renderHook(() => useSessionRecorder(options()))
    expect(() => act(() => result.current.stop())).not.toThrow()
    expect(MockMediaRecorder.instances).toHaveLength(0)
  })
})
