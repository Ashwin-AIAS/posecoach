import { useCallback, useEffect, useRef, useState } from "react"

interface UseCameraOptions {
  readonly width?: number
  readonly height?: number
  readonly facingMode?: "user" | "environment"
}

interface UseCameraResult {
  readonly videoRef: React.RefObject<HTMLVideoElement>
  readonly ready: boolean
  readonly error: string | null
  readonly stop: () => void
  readonly start: () => Promise<void>
}

/**
 * Acquires the user's webcam via getUserMedia and attaches the stream to a
 * <video> element. Handles visibilitychange to release the camera when the
 * tab is hidden.
 */
export function useCamera(options: UseCameraOptions = {}): UseCameraResult {
  const { width = 640, height = 480, facingMode = "user" } = options
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setReady(false)
  }, [])

  const start = useCallback(async () => {
    if (streamRef.current) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width, height, facingMode },
        audio: false,
      })
      streamRef.current = stream
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        await video.play()
        setReady(true)
        setError(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "camera_failed")
      setReady(false)
    }
  }, [width, height, facingMode])

  useEffect(() => {
    const onVisibilityChange = (): void => {
      if (document.hidden) {
        stop()
      } else {
        void start()
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
      stop()
    }
  }, [start, stop])

  return { videoRef, ready, error, stop, start }
}
