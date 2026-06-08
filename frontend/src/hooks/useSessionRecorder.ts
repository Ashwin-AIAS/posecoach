/**
 * On-device session recorder (spec §3.1–3.5).
 *
 * Composites the three independent on-screen layers — camera `<video>`, the pose
 * overlay `<canvas>`, and a native re-draw of the HUD — into one hidden canvas,
 * then records that canvas with `MediaRecorder`. The clip is held in memory so
 * the user can preview it in-app before sharing; nothing is uploaded and no
 * server endpoint is involved (spec §5).
 */

import { useCallback, useEffect, useRef, useState } from "react"

import type { Exercise } from "../types"

/**
 * Codec preference — mp4 first for iOS Safari (records mp4 natively),
 * webm fallback for desktop Chrome/Firefox.
 */
const MIME_CANDIDATES = [
  "video/mp4;codecs=h264",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const

const DEFAULT_FPS = 30
/** Throttle the live REC-timer state updates so we don't re-render per frame. */
const ELAPSED_INTERVAL_MS = 250

/** Recorded session ready for in-app playback + share. */
export interface RecordedSession {
  readonly blob: Blob
  readonly fileName: string
  readonly mimeType: string
}

export interface UseSessionRecorderOptions {
  readonly videoRef: React.RefObject<HTMLVideoElement>
  /** Getter for the live pose-overlay canvas (from `PoseOverlay` onCanvasReady). */
  readonly overlayCanvas: () => HTMLCanvasElement | null
  /** Native HUD re-draw onto the compositor (closes over the latest PoseResult). */
  readonly drawHud: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
  /** Mirror the video draw to match the mirrored front-camera display. */
  readonly mirrored: boolean
  /** Active exercise — only used to name the saved file. */
  readonly exercise: Exercise
  /** Compositor frame rate; default 30, drop to 24 on weak devices (spec §4). */
  readonly fps?: number
}

export interface UseSessionRecorderResult {
  /** MediaRecorder + a usable codec + canvas.captureStream are all available. */
  readonly supported: boolean
  readonly recording: boolean
  readonly elapsedMs: number
  readonly start: () => void
  readonly stop: () => void
  readonly error: string | null
  /** The last completed recording, ready for in-app playback. null if none. */
  readonly lastRecording: RecordedSession | null
  /** Dismiss the last recording (frees memory). */
  readonly clearRecording: () => void
}

/** First codec the platform can actually record, or "" if none. */
export function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return ""
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? ""
}

/** File extension for a recorded mime type. */
export function extensionForMime(mime: string): string {
  return mime.includes("mp4") ? "mp4" : "webm"
}

function computeSupported(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    pickMimeType() !== "" &&
    typeof HTMLCanvasElement !== "undefined" &&
    "captureStream" in HTMLCanvasElement.prototype
  )
}

/** navigator.share with files isn't in every lib.dom; type it locally (no `any`). */
interface FileShareData {
  readonly files: readonly File[]
  readonly title?: string
}
type ShareCapableNavigator = Navigator & {
  canShare?: (data: FileShareData) => boolean
  share?: (data: FileShareData) => Promise<void>
}

export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file)
  const a = document.createElement("a")
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Defer revoke so the navigation/download can start first.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export async function shareFile(file: File): Promise<void> {
  const nav = navigator as ShareCapableNavigator
  if (nav.canShare?.({ files: [file] }) && nav.share !== undefined) {
    try {
      await nav.share({ files: [file], title: "My PoseCoach session" })
      return
    } catch (e: unknown) {
      // AbortError = user dismissed share sheet — not a real error.
      if (e instanceof Error && e.name === "AbortError") return
      // Other errors — fall through to download.
    }
  }
  downloadFile(file)
}

/** True if the browser can share files natively (mobile share sheet). */
export function canShareFiles(): boolean {
  const nav = navigator as ShareCapableNavigator
  if (typeof nav.canShare !== "function" || typeof nav.share !== "function") return false
  try {
    const testFile = new File([""], "test.mp4", { type: "video/mp4" })
    return nav.canShare({ files: [testFile] })
  } catch {
    return false
  }
}

/**
 * Owns the recording lifecycle and the compositor draw loop. `start()` builds a
 * hidden canvas at the video's intrinsic resolution, composites each frame, and
 * records it; `stop()` flushes the chunks to an in-memory blob exposed via
 * `lastRecording` for in-app preview. The user can then share or download.
 * Cleans up the rAF loop and recorder on unmount.
 */
export function useSessionRecorder(options: UseSessionRecorderOptions): UseSessionRecorderResult {
  const [supported] = useState(computeSupported)
  const [recording, setRecording] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [lastRecording, setLastRecording] = useState<RecordedSession | null>(null)

  // Latest options mirrored into a ref so the rAF loop never re-subscribes.
  const optsRef = useRef(options)
  optsRef.current = options

  const recorderRef = useRef<MediaRecorder | null>(null)
  const compositorRef = useRef<HTMLCanvasElement | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeRef = useRef("")
  const rafRef = useRef(0)
  const recordingRef = useRef(false)
  const startedAtRef = useRef(0)
  const lastDrawRef = useRef(0)
  const lastElapsedRef = useRef(0)

  const clearRecording = useCallback(() => {
    setLastRecording(null)
  }, [])

  const drawFrame = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number): void => {
    const { videoRef, overlayCanvas, drawHud, mirrored } = optsRef.current
    const video = videoRef.current
    ctx.clearRect(0, 0, w, h)
    if (video !== null && video.readyState >= 2) {
      ctx.save()
      if (mirrored) {
        ctx.translate(w, 0)
        ctx.scale(-1, 1)
      }
      ctx.drawImage(video, 0, 0, w, h)
      ctx.restore()
    }
    const overlay = overlayCanvas()
    if (overlay !== null) {
      try {
        ctx.drawImage(overlay, 0, 0, w, h)
      } catch {
        // Overlay canvas not yet sized/painted — skip it this frame.
      }
    }
    drawHud(ctx, w, h)
  }, [])

  const renderOnce = useCallback((): void => {
    const canvas = compositorRef.current
    if (canvas === null) return
    const ctx = canvas.getContext("2d")
    if (ctx === null) return
    drawFrame(ctx, canvas.width, canvas.height)
  }, [drawFrame])

  const tick = useCallback((): void => {
    if (!recordingRef.current) return
    rafRef.current = requestAnimationFrame(tick)
    const now = performance.now()
    if (now - lastElapsedRef.current >= ELAPSED_INTERVAL_MS) {
      lastElapsedRef.current = now
      setElapsedMs(now - startedAtRef.current)
    }
    const frameMs = 1000 / (optsRef.current.fps ?? DEFAULT_FPS)
    if (now - lastDrawRef.current < frameMs) return
    lastDrawRef.current = now
    renderOnce()
  }, [renderOnce])

  const finalize = useCallback((): void => {
    const chunks = chunksRef.current
    chunksRef.current = []
    if (chunks.length === 0) return
    const mime = mimeRef.current
    const blob = new Blob(chunks, { type: mime })
    const ext = extensionForMime(mime)
    const name = `posecoach-${optsRef.current.exercise}-${Date.now()}.${ext}`
    setLastRecording({ blob, fileName: name, mimeType: mime })
  }, [])

  const start = useCallback((): void => {
    if (recordingRef.current) return
    const video = optsRef.current.videoRef.current
    const mime = pickMimeType()
    if (video === null || mime === "") {
      setError("recording_unsupported")
      return
    }
    const w = video.videoWidth || video.clientWidth || 640
    const h = video.videoHeight || video.clientHeight || 480
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (ctx === null) {
      setError("canvas_unavailable")
      return
    }
    let recorder: MediaRecorder
    try {
      const stream = canvas.captureStream(optsRef.current.fps ?? DEFAULT_FPS)
      recorder = new MediaRecorder(stream, { mimeType: mime })
    } catch {
      setError("recorder_init_failed")
      return
    }

    compositorRef.current = canvas
    chunksRef.current = []
    mimeRef.current = mime
    recorder.ondataavailable = (event: BlobEvent): void => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.onstop = (): void => {
      finalize()
    }
    recorderRef.current = recorder

    const now = performance.now()
    startedAtRef.current = now
    lastDrawRef.current = 0
    lastElapsedRef.current = now
    recordingRef.current = true
    setError(null)
    setElapsedMs(0)
    setRecording(true)
    // Clear any previous recording when starting a new one
    setLastRecording(null)

    recorder.start(1000) // periodic chunks so a long clip survives a tab kill
    renderOnce() // paint the first frame immediately, then drive the loop
    rafRef.current = requestAnimationFrame(tick)
  }, [finalize, renderOnce, tick])

  const stop = useCallback((): void => {
    if (!recordingRef.current) return
    recordingRef.current = false
    setRecording(false)
    if (rafRef.current !== 0) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    const recorder = recorderRef.current
    if (recorder !== null && recorder.state !== "inactive") {
      recorder.stop() // fires onstop → finalize() → sets lastRecording
    } else {
      finalize()
    }
  }, [finalize])

  // Release the recorder and rAF loop if the component unmounts mid-recording.
  useEffect(() => {
    return () => {
      recordingRef.current = false
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current)
      const recorder = recorderRef.current
      if (recorder !== null && recorder.state !== "inactive") recorder.stop()
    }
  }, [])

  return {
    supported, recording, elapsedMs, start, stop, error,
    lastRecording, clearRecording,
  }
}
