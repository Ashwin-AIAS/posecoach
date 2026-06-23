import { useCallback, useEffect, useRef, useState } from "react"

import type { Exercise, PoseName, PoseResult, ServerMessage, SessionMode } from "../types"
import { isPoseError } from "../types"
import { useWebSocket } from "./useWebSocket"

// Cap the capture loop at 15 FPS. The single-in-flight backpressure below means
// the effective rate self-throttles to whatever the server can sustain, so on a
// fast link this approaches 15 FPS (real-time feel) and on a slow one it backs
// off automatically — without ever flooding the socket.
const FPS_CAP = 15
const MIN_FRAME_INTERVAL_MS = 1000 / FPS_CAP // ~66ms

// Capture profiles. The long side is intentionally small to keep per-frame
// latency low; under a high round-trip we degrade further to claw back
// responsiveness. Sized by long side (not fixed width×height) so the capture
// canvas matches the video's true aspect instead of squishing a 16:9 back
// camera into a hardcoded 4:3 box — see
// docs/enhancements/FIX_BACK_CAMERA_POSE_QUALITY.md §2A/§5 Phase 2.
const LONG_SIDE_NORMAL = 384 // ~44% more linear resolution than the old 320-wide 4:3 capture
const LONG_SIDE_DEGRADED = 288
const QUALITY_NORMAL = 0.65
const QUALITY_DEGRADED = 0.5
const RTT_DEGRADE_MS = 80 // switch to the degraded profile above this smoothed RTT
const RTT_ALPHA = 0.3 // EMA factor for the measured round-trip

interface UsePoseStreamOptions {
  readonly videoRef: React.RefObject<HTMLVideoElement>
  readonly exercise: Exercise
  readonly active: boolean
  /** "exercise" (default) streams rep-based scoring; "posing" scores a held pose (P15). */
  readonly mode?: SessionMode
  /** Active pose when `mode === "posing"`. Ignored in exercise mode. */
  readonly pose?: PoseName
  readonly wsUrl?: string
}

interface UsePoseStreamResult {
  readonly result: PoseResult | null
  readonly error: string | null
  readonly connectionState: ReturnType<typeof useWebSocket>["state"]
}

function getDefaultWsUrl(): string {
  const envUrl = (import.meta.env.VITE_API_URL as string) || ""
  if (envUrl) {
    const wsBase = envUrl.replace(/^http/, "ws")
    return `${wsBase}/ws/inference`
  }
  if (typeof window === "undefined") return "ws://localhost:8000/ws/inference"
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${window.location.host}/ws/inference`
}

/**
 * Captures frames from a video element at 15 FPS and streams them to the
 * inference WebSocket. Backpressure: skips a frame if the previous result
 * hasn't returned yet (no queuing on the wire).
 */
export function usePoseStream(opts: UsePoseStreamOptions): UsePoseStreamResult {
  const { videoRef, exercise, active, mode = "exercise", pose = "front_double_biceps", wsUrl } = opts
  const [result, setResult] = useState<PoseResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const inFlightRef = useRef(false)
  const lastSentMsRef = useRef(0)
  const sentAtRef = useRef(0) // performance.now() of the in-flight frame
  const rttEmaRef = useRef(0) // smoothed round-trip latency, ms
  const rafRef = useRef<number | null>(null)
  const exerciseRef = useRef<Exercise>(exercise)
  const modeRef = useRef<SessionMode>(mode)
  const poseRef = useRef<PoseName>(pose)

  useEffect(() => {
    exerciseRef.current = exercise
  }, [exercise])

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  useEffect(() => {
    poseRef.current = pose
  }, [pose])

  const handleMessage = useCallback((msg: ServerMessage) => {
    // Measure the round-trip of the frame that just came back, before clearing
    // the in-flight flag, to drive the adaptive capture profile.
    if (sentAtRef.current > 0) {
      const rtt = performance.now() - sentAtRef.current
      rttEmaRef.current =
        rttEmaRef.current === 0 ? rtt : RTT_ALPHA * rtt + (1 - RTT_ALPHA) * rttEmaRef.current
    }
    inFlightRef.current = false
    if (isPoseError(msg)) {
      setError(msg.error)
      return
    }
    setError(null)
    setResult(msg)
  }, [])

  const ws = useWebSocket({
    url: wsUrl ?? getDefaultWsUrl(),
    onMessage: handleMessage,
    autoConnect: true,
  })

  const captureAndSend = useCallback((): void => {
    const video = videoRef.current
    if (!video || video.readyState < 2) return
    if (inFlightRef.current) return

    // Adaptive quality: drop resolution + JPEG quality when the round-trip is high.
    const degraded = rttEmaRef.current > RTT_DEGRADE_MS
    const longSide = degraded ? LONG_SIDE_DEGRADED : LONG_SIDE_NORMAL
    const quality = degraded ? QUALITY_DEGRADED : QUALITY_NORMAL

    // Size the canvas to the video's true aspect ratio, capping the long side —
    // no more stretching a 16:9 source into a fixed 4:3 box.
    const vw = video.videoWidth || 640
    const vh = video.videoHeight || 480
    const scale = longSide / Math.max(vw, vh)
    const cw = Math.max(1, Math.round(vw * scale))
    const ch = Math.max(1, Math.round(vh * scale))

    let canvas = captureCanvasRef.current
    if (!canvas) {
      canvas = document.createElement("canvas")
      captureCanvasRef.current = canvas
    }
    if (canvas.width !== cw) canvas.width = cw
    if (canvas.height !== ch) canvas.height = ch
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    ctx.drawImage(video, 0, 0, cw, ch) // aspect preserved — no squish
    const dataUrl = canvas.toDataURL("image/jpeg", quality)
    const base64 = dataUrl.split(",", 2)[1] ?? ""

    const payload =
      modeRef.current === "posing"
        ? { frame: base64, mode: "posing", pose: poseRef.current }
        : { frame: base64, exercise: exerciseRef.current }
    const sent = ws.send(payload)
    if (sent) {
      inFlightRef.current = true
      sentAtRef.current = performance.now()
    }
  }, [videoRef, ws])

  useEffect(() => {
    if (!active) return

    const loop = (): void => {
      const now = performance.now()
      if (now - lastSentMsRef.current >= MIN_FRAME_INTERVAL_MS) {
        lastSentMsRef.current = now
        captureAndSend()
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      inFlightRef.current = false
    }
  }, [active, captureAndSend])

  return { result, error, connectionState: ws.state }
}
