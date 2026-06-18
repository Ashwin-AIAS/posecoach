import { useCallback, useEffect, useRef, useState } from "react"

type FacingMode = "user" | "environment"

interface UseCameraOptions {
  readonly width?: number
  readonly height?: number
  readonly facingMode?: FacingMode
}

interface UseCameraResult {
  readonly videoRef: React.RefObject<HTMLVideoElement>
  readonly ready: boolean
  readonly error: string | null
  readonly facingMode: FacingMode
  readonly switching: boolean
  readonly stop: () => void
  readonly start: () => Promise<void>
  readonly flip: () => Promise<void>
}

/**
 * Acquires the user's webcam via getUserMedia and attaches the stream to a
 * <video> element. Handles visibilitychange to release the camera when the
 * tab is hidden.
 */
export function useCamera(options: UseCameraOptions = {}): UseCameraResult {
  const { width = 640, height = 480, facingMode: initialFacingMode = "user" } = options
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<FacingMode>(initialFacingMode)
  const [switching, setSwitching] = useState(false)

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

  /**
   * Switches between the front (user) and back (environment) camera. start()
   * early-returns on an existing stream, so we MUST stop first. Falls back to
   * the previous mode if the requested camera does not exist (desktops have a
   * single camera and ignore facingMode gracefully).
   */
  const flip = useCallback(async () => {
    const previous = facingMode
    const next: FacingMode = previous === "user" ? "environment" : "user"
    stop()
    setSwitching(true)
    try {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width, height, facingMode: next },
          audio: false,
        })
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play()
        }
        setFacingMode(next)
        setReady(true)
        setError(null)
      } catch {
        // Requested camera unavailable — restore the previous mode.
        setFacingMode(previous)
        streamRef.current = null
        await start()
      }
    } finally {
      setSwitching(false)
    }
  }, [facingMode, width, height, stop, start])

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

  return { videoRef, ready, error, facingMode, switching, stop, start, flip }
}
