import { useCallback, useEffect, useRef, useState } from "react"

import type { Exercise, PoseResult, ServerMessage } from "../types"
import { isPoseError } from "../types"
import { useWebSocket } from "./useWebSocket"

// Cap the capture loop at 15 FPS. The single-in-flight backpressure below means
// the effective rate self-throttles to whatever the server can sustain, so on a
// fast link this approaches 15 FPS (real-time feel) and on a slow one it backs
// off automatically — without ever flooding the socket.
const FPS_CAP = 15
const MIN_FRAME_INTERVAL_MS = 1000 / FPS_CAP // ~66ms

// Capture profiles. The base frame is intentionally small (well under the
// 640×480 cap) to keep per-frame latency low; under a high round-trip we degrade
// further to 256×192 / q0.5 to claw back responsiveness.
const NORMAL_PROFILE = { width: 320, height: 240, quality: 0.65 } as const
const DEGRADED_PROFILE = { width: 256, height: 192, quality: 0.5 } as const
const RTT_DEGRADE_MS = 80 // switch to the degraded profile above this smoothed RTT
const RTT_ALPHA = 0.3 // EMA factor for the measured round-trip

interface UsePoseStreamOptions {
  readonly videoRef: React.RefObject<HTMLVideoElement>
  readonly exercise: Exercise
  readonly active: boolean
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
  const { videoRef, exercise, active, wsUrl } = opts
  const [result, setResult] = useState<PoseResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const inFlightRef = useRef(false)
  const lastSentMsRef = useRef(0)
  const sentAtRef = useRef(0) // performance.now() of the in-flight frame
  const rttEmaRef = useRef(0) // smoothed round-trip latency, ms
  const rafRef = useRef<number | null>(null)
  const exerciseRef = useRef<Exercise>(exercise)

  useEffect(() => {
    exerciseRef.current = exercise
  }, [exercise])

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
    const profile = rttEmaRef.current > RTT_DEGRADE_MS ? DEGRADED_PROFILE : NORMAL_PROFILE

    let canvas = captureCanvasRef.current
    if (!canvas) {
      canvas = document.createElement("canvas")
      captureCanvasRef.current = canvas
    }
    if (canvas.width !== profile.width) canvas.width = profile.width
    if (canvas.height !== profile.height) canvas.height = profile.height
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    ctx.drawImage(video, 0, 0, profile.width, profile.height)
    const dataUrl = canvas.toDataURL("image/jpeg", profile.quality)
    const base64 = dataUrl.split(",", 2)[1] ?? ""

    const sent = ws.send({ frame: base64, exercise: exerciseRef.current })
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
