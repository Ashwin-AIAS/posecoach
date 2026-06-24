import { useCallback, useEffect, useRef, useState } from "react"

import { DARK_LUMA_THRESHOLD, LOW_LIGHT_FILTER, LUMA_PROBE_SIZE, meanLuma } from "../lib/luma"
import type { Exercise, PoseName, PoseResult, ServerMessage, SessionMode } from "../types"
import { isPoseError } from "../types"
import { useWebSocket } from "./useWebSocket"

// Cap the capture loop at 15 FPS. The single-in-flight backpressure below means
// the effective rate self-throttles to whatever the server can sustain, so on a
// fast link this approaches 15 FPS (real-time feel) and on a slow one it backs
// off automatically — without ever flooding the socket.
const FPS_CAP = 15
const MIN_FRAME_INTERVAL_MS = 1000 / FPS_CAP // ~66ms

// Capture profiles. Sized by long side (not fixed width×height) so the capture
// canvas matches the video's true aspect instead of squishing a 16:9 back
// camera into a hardcoded 4:3 box — see
// docs/enhancements/FIX_BACK_CAMERA_POSE_QUALITY.md §2A/§5 Phase 2.
//
// Raised 384→512 / 288→384 so the JPEG actually carries enough detail for the
// 640 model to lock onto a small, distant mirror subject
// (docs/enhancements/FIX_POSE_TRACKING_QUALITY.md §3B/Phase 2). A starved 320/384
// capture was a second reason distant subjects dropped out.
const LONG_SIDE_NORMAL = 512
const LONG_SIDE_DEGRADED = 384
const QUALITY_NORMAL = 0.6
const QUALITY_DEGRADED = 0.5
// Adaptive profile thresholds (smoothed RTT, ms). Quality drops above
// RTT_DEGRADE_MS; resolution only drops above the much higher
// RTT_RESOLUTION_DROP_MS. Decoupling them (§3D/Phase 4) keeps accurate tracking —
// the thing the user actually wants — under a normal deployed round-trip, where
// the old single 80 ms threshold pinned the app permanently in the degraded,
// low-detail profile (live RTT = network + 2-vCPU inference is routinely > 80).
// FPS is not part of this: the single-in-flight backpressure already self-paces
// the frame rate to whatever the server can sustain.
const RTT_DEGRADE_MS = 160 // lower JPEG quality above this smoothed RTT
const RTT_RESOLUTION_DROP_MS = 300 // drop capture resolution only when truly pathological
const RTT_ALPHA = 0.3 // EMA factor for the measured round-trip

// Low-light assist (§3E/Phase 5): lift only genuinely dark capture frames before
// encoding. Conservative + self-limiting (never fires in normal light), so it is
// safe to ship on; flip to false to disable if a device check shows it washes out.
const LOW_LIGHT_ASSIST = true

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
  const lumaCanvasRef = useRef<HTMLCanvasElement | null>(null) // tiny off-screen luma probe
  const inFlightRef = useRef(false)
  const lastSentMsRef = useRef(0)
  const sentAtRef = useRef(0) // performance.now() of the in-flight frame
  const rttEmaRef = useRef(0) // smoothed round-trip latency, ms
  const lastProfileRef = useRef("") // last logged capture profile (log only on change)
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

  // Mean luma of a tiny off-screen down-sample of the current video frame, or
  // null if the canvas can't be read (e.g. jsdom, or a tainted/uninitialized
  // context). Cheap — LUMA_PROBE_SIZE² pixels — and guarded so it never throws.
  const sampleLuma = useCallback((video: HTMLVideoElement): number | null => {
    try {
      let probe = lumaCanvasRef.current
      if (!probe) {
        probe = document.createElement("canvas")
        probe.width = LUMA_PROBE_SIZE
        probe.height = LUMA_PROBE_SIZE
        lumaCanvasRef.current = probe
      }
      const lctx = probe.getContext("2d", { willReadFrequently: true })
      // `getImageData` absent ⇒ no real canvas backend (jsdom) ⇒ skip the probe
      // entirely so we never draw a phantom frame or throw.
      if (!lctx || typeof lctx.getImageData !== "function") return null
      lctx.drawImage(video, 0, 0, LUMA_PROBE_SIZE, LUMA_PROBE_SIZE)
      return meanLuma(lctx.getImageData(0, 0, LUMA_PROBE_SIZE, LUMA_PROBE_SIZE).data)
    } catch {
      return null
    }
  }, [])

  const captureAndSend = useCallback((): void => {
    const video = videoRef.current
    if (!video || video.readyState < 2) return
    if (inFlightRef.current) return

    // Adaptive profile (§3D/Phase 4): lower JPEG quality above RTT_DEGRADE_MS but
    // keep full resolution until the round-trip is genuinely pathological, so a
    // normal deployed RTT no longer pins the capture to the low-detail profile.
    const rtt = rttEmaRef.current
    const longSide = rtt > RTT_RESOLUTION_DROP_MS ? LONG_SIDE_DEGRADED : LONG_SIDE_NORMAL
    const quality = rtt > RTT_DEGRADE_MS ? QUALITY_DEGRADED : QUALITY_NORMAL

    // Lightweight client gauge: log only when the chosen profile changes, so we
    // can confirm the deployed app settles on the normal (full-detail) profile
    // at typical server RTT instead of being stuck degraded.
    const profileKey = `${longSide}@${quality}`
    if (profileKey !== lastProfileRef.current) {
      lastProfileRef.current = profileKey
      console.debug(`[posestream] profile=${longSide}px q${quality} rtt=${Math.round(rtt)}ms`)
    }

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

    // Low-light assist (§3E/Phase 5): probe a tiny down-sample for mean luma and,
    // only on genuinely dark frames, lift brightness/contrast before encoding so
    // dim-room keypoints stay above the confidence gates. No-ops in normal light.
    ctx.filter = "none"
    if (LOW_LIGHT_ASSIST) {
      const luma = sampleLuma(video)
      if (luma !== null && luma < DARK_LUMA_THRESHOLD) ctx.filter = LOW_LIGHT_FILTER
    }
    ctx.drawImage(video, 0, 0, cw, ch) // aspect preserved — no squish
    ctx.filter = "none" // reset so the filter never leaks into a later draw
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
  }, [videoRef, ws, sampleLuma])

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
