import { useCallback, useEffect, useRef, useState } from "react"

import type { Exercise, PoseResult, ServerMessage } from "../types"
import { isPoseError } from "../types"
import { useWebSocket } from "./useWebSocket"

const MIN_FRAME_INTERVAL_MS = 500 // 2 FPS — matches throughput on Render free/Starter CPU
const FRAME_WIDTH = 320
const FRAME_HEIGHT = 240
const JPEG_QUALITY = 0.7

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
  const rafRef = useRef<number | null>(null)
  const exerciseRef = useRef<Exercise>(exercise)

  useEffect(() => {
    exerciseRef.current = exercise
  }, [exercise])

  const handleMessage = useCallback((msg: ServerMessage) => {
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

    let canvas = captureCanvasRef.current
    if (!canvas) {
      canvas = document.createElement("canvas")
      canvas.width = FRAME_WIDTH
      canvas.height = FRAME_HEIGHT
      captureCanvasRef.current = canvas
    }
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    ctx.drawImage(video, 0, 0, FRAME_WIDTH, FRAME_HEIGHT)
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY)
    const base64 = dataUrl.split(",", 2)[1] ?? ""

    const sent = ws.send({ frame: base64, exercise: exerciseRef.current })
    if (sent) {
      inFlightRef.current = true
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
