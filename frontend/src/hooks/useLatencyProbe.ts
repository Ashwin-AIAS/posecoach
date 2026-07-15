import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Latency diagnostics probe (P31 — LATENCY_OPTIMIZATION_PLAN.md Phase 2 §1).
 *
 * Opens its OWN WebSocket to /ws/inference (never the live pose stream's) and
 * sends ~50 real camera frames single-in-flight, recording per frame:
 *
 *   encode_ms   — JPEG capture+encode on this device
 *   rtt_ms      — send → reply round-trip
 *   server_ms   — the server's own `latency_ms` (decode + model inference)
 *   network_ms  — rtt − server = network + client/server overhead share
 *
 * The summary (p50/p95 per stage + effective FPS) is what picks between the
 * Phase 2 workstreams: network-dominated → on-device inference; server ≫ the
 * 55 ms benchmark → Space contention/tier; neither → perception/overlay work.
 *
 * Additive only: no frozen camera/pose hook is imported or modified.
 */

export const PROBE_FRAME_COUNT = 50
// Mirror usePoseStream's NORMAL capture profile so the probe measures what the
// real app sends on a healthy link (512px long side, JPEG q0.6, squat frames).
const LONG_SIDE = 512
const JPEG_QUALITY = 0.6
const PROBE_EXERCISE = "squat"
const SETUP_TIMEOUT_MS = 10_000
const REPLY_TIMEOUT_MS = 15_000

// ── Dev flag ─────────────────────────────────────────────────────────────────
// The panel is hidden from real users: visible in dev builds, and in production
// only after visiting `?diag=1` once (persisted locally; `?diag=0` turns it
// back off). This is what lets the probe run on a phone against the live Space.
const FLAG_KEY = "pc.latencyDiag"

export function isLatencyDiagEnabled(): boolean {
  if (typeof window === "undefined") return false
  try {
    const qp = new URLSearchParams(window.location.search).get("diag")
    if (qp === "1") window.localStorage.setItem(FLAG_KEY, "1")
    else if (qp === "0") window.localStorage.removeItem(FLAG_KEY)
    if (window.localStorage.getItem(FLAG_KEY) === "1") return true
  } catch {
    // Storage unavailable (private mode) — fall through to the build-mode check.
  }
  return import.meta.env.DEV
}

// ── Result types ─────────────────────────────────────────────────────────────

/** The subset of the /ws/inference reply the probe reads. */
export interface ProbeReply {
  readonly error?: string
  readonly code?: string
  readonly latency_ms?: number
  readonly status?: string
}

export interface ProbeSample {
  readonly seq: number
  readonly encode_ms: number
  readonly rtt_ms: number
  /** Server-reported inference latency; null when unreported (e.g. no_person → 0). */
  readonly server_ms: number | null
  /** rtt − server, clamped ≥ 0; null whenever server_ms is null. */
  readonly network_ms: number | null
  readonly status: string
}

export interface StageStats {
  readonly n: number
  readonly p50_ms: number
  readonly p95_ms: number
  readonly mean_ms: number
}

export interface ProbeSummary {
  readonly url: string
  readonly started_at: string
  readonly user_agent: string
  readonly frames_requested: number
  readonly frames_completed: number
  readonly duration_s: number
  readonly effective_fps: number
  readonly capture: {
    readonly long_side: number
    readonly jpeg_quality: number
    readonly exercise: string
  }
  readonly status_counts: Readonly<Record<string, number>>
  readonly stages: {
    readonly encode: StageStats
    readonly rtt: StageStats
    readonly server: StageStats
    readonly network: StageStats
  }
  readonly samples: readonly ProbeSample[]
}

// ── Pure helpers (exported for unit tests) ───────────────────────────────────

/** Linear-interpolated percentile (pct in 0..1) — mirrors the server's helper. */
export function percentile(values: readonly number[], pct: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = (sorted.length - 1) * pct
  const lo = Math.floor(rank)
  const hi = Math.min(lo + 1, sorted.length - 1)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

function stageStats(values: readonly number[]): StageStats {
  if (values.length === 0) return { n: 0, p50_ms: 0, p95_ms: 0, mean_ms: 0 }
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return {
    n: values.length,
    p50_ms: round1(percentile(values, 0.5)),
    p95_ms: round1(percentile(values, 0.95)),
    mean_ms: round1(mean),
  }
}

/**
 * One reply → one sample. A `latency_ms` of 0 means the server did not report
 * inference time for this frame (the no_person response hardcodes 0), so the
 * server/network split is recorded as null rather than blaming the network.
 */
export function buildSample(
  seq: number,
  encodeMs: number,
  rttMs: number,
  reply: ProbeReply,
): ProbeSample {
  const server =
    typeof reply.latency_ms === "number" && reply.latency_ms > 0 ? reply.latency_ms : null
  return {
    seq,
    encode_ms: round1(encodeMs),
    rtt_ms: round1(rttMs),
    server_ms: server === null ? null : round1(server),
    network_ms: server === null ? null : round1(Math.max(0, rttMs - server)),
    status: reply.error !== undefined ? "error" : (reply.status ?? "ok"),
  }
}

export function summarize(
  samples: readonly ProbeSample[],
  opts: {
    readonly url: string
    readonly startedAtIso: string
    readonly durationMs: number
    readonly framesRequested: number
    readonly userAgent: string
  },
): ProbeSummary {
  const statusCounts: Record<string, number> = {}
  for (const s of samples) statusCounts[s.status] = (statusCounts[s.status] ?? 0) + 1
  const withServer = samples.filter((s) => s.server_ms !== null)
  const durationS = opts.durationMs / 1000
  return {
    url: opts.url,
    started_at: opts.startedAtIso,
    user_agent: opts.userAgent,
    frames_requested: opts.framesRequested,
    frames_completed: samples.length,
    duration_s: round1(durationS),
    effective_fps: durationS > 0 ? round1(samples.length / durationS) : 0,
    capture: { long_side: LONG_SIDE, jpeg_quality: JPEG_QUALITY, exercise: PROBE_EXERCISE },
    status_counts: statusCounts,
    stages: {
      encode: stageStats(samples.map((s) => s.encode_ms)),
      rtt: stageStats(samples.map((s) => s.rtt_ms)),
      server: stageStats(withServer.map((s) => s.server_ms as number)),
      network: stageStats(withServer.map((s) => s.network_ms as number)),
    },
    samples,
  }
}

// ── Connection plumbing ──────────────────────────────────────────────────────

/** Same resolution logic as the live stream: VITE_API_URL, else same-origin (P30). */
export function getProbeWsUrl(): string {
  const envUrl = (import.meta.env.VITE_API_URL as string) || ""
  if (envUrl) return `${envUrl.replace(/^http/, "ws")}/ws/inference`
  if (typeof window === "undefined") return "ws://localhost:8000/ws/inference"
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${window.location.host}/ws/inference`
}

// Connection-level rejections the server sends before closing the socket.
const FATAL_CODES: Readonly<Record<string, string>> = {
  capacity: "The server is at capacity — try again in a minute.",
  anon_limit: "Too many anonymous connections from this network — sign in or retry later.",
  duplicate_connection:
    "Your account already has a live inference session (the Coach tab keeps one connected). " +
    "Close the live view or wait ~2 minutes, then retry.",
}

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const timer = window.setTimeout(() => {
      ws.close()
      reject(new Error("WebSocket connection timed out"))
    }, SETUP_TIMEOUT_MS)
    ws.onopen = (): void => {
      window.clearTimeout(timer)
      ws.onopen = null
      ws.onerror = null
      resolve(ws)
    }
    ws.onerror = (): void => {
      window.clearTimeout(timer)
      reject(new Error(`Could not connect to ${url}`))
    }
  })
}

function waitForVideo(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const detach = (): void => {
      window.clearTimeout(timer)
      video.removeEventListener("loadeddata", onReady)
    }
    const timer = window.setTimeout(() => {
      detach()
      reject(new Error("Camera stream never became ready"))
    }, SETUP_TIMEOUT_MS)
    const onReady = (): void => {
      detach()
      resolve()
    }
    video.addEventListener("loadeddata", onReady)
  })
}

/** One-shot reply await. Installed BEFORE send so a fast reply is never missed. */
function awaitReply(ws: WebSocket): Promise<ProbeReply> {
  return new Promise((resolve, reject) => {
    const detach = (): void => {
      window.clearTimeout(timer)
      ws.removeEventListener("message", onMessage)
      ws.removeEventListener("close", onClose)
    }
    const timer = window.setTimeout(() => {
      detach()
      reject(new Error("Timed out waiting for a server reply (15s)"))
    }, REPLY_TIMEOUT_MS)
    const onMessage = (ev: MessageEvent): void => {
      detach()
      try {
        resolve(JSON.parse(String(ev.data)) as ProbeReply)
      } catch {
        reject(new Error("Received an unparseable server reply"))
      }
    }
    const onClose = (): void => {
      detach()
      reject(new Error("The server closed the connection mid-probe"))
    }
    ws.addEventListener("message", onMessage)
    ws.addEventListener("close", onClose)
  })
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

// ── The hook ─────────────────────────────────────────────────────────────────

export type ProbePhase = "idle" | "preparing" | "running" | "done" | "error"

export interface UseLatencyProbeResult {
  readonly phase: ProbePhase
  /** Frames completed so far (updates live while running). */
  readonly completed: number
  readonly total: number
  readonly summary: ProbeSummary | null
  readonly error: string | null
  readonly start: () => void
  readonly cancel: () => void
}

/**
 * Runs the latency probe against the given preview `<video>` element. The hook
 * owns the camera stream and the WebSocket for the duration of one run and
 * always releases both when the run ends, errors, is cancelled, or unmounts.
 */
export function useLatencyProbe(
  videoRef: React.RefObject<HTMLVideoElement>,
  frames: number = PROBE_FRAME_COUNT,
): UseLatencyProbeResult {
  const [phase, setPhase] = useState<ProbePhase>("idle")
  const [completed, setCompleted] = useState(0)
  const [summary, setSummary] = useState<ProbeSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Bumping the run id invalidates any in-flight run (cancel / restart / unmount).
  const runIdRef = useRef(0)
  const activeRef = useRef(false)
  const wsRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const releaseMedia = useCallback((): void => {
    const ws = wsRef.current
    wsRef.current = null
    if (ws !== null && ws.readyState <= WebSocket.OPEN) ws.close()
    const stream = streamRef.current
    streamRef.current = null
    stream?.getTracks().forEach((t) => t.stop())
    const video = videoRef.current
    if (video) video.srcObject = null
  }, [videoRef])

  const encodeFrame = useCallback(
    (video: HTMLVideoElement): { b64: string; encodeMs: number } => {
      const vw = video.videoWidth || 640
      const vh = video.videoHeight || 480
      const scale = LONG_SIDE / Math.max(vw, vh)
      const cw = Math.max(1, Math.round(vw * scale))
      const ch = Math.max(1, Math.round(vh * scale))
      let canvas = canvasRef.current
      if (!canvas) {
        canvas = document.createElement("canvas")
        canvasRef.current = canvas
      }
      if (canvas.width !== cw) canvas.width = cw
      if (canvas.height !== ch) canvas.height = ch
      const ctx = canvas.getContext("2d")
      if (!ctx) throw new Error("Canvas 2D context unavailable")
      const t0 = performance.now()
      ctx.drawImage(video, 0, 0, cw, ch)
      const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY)
      const encodeMs = performance.now() - t0
      const b64 = dataUrl.split(",", 2)[1] ?? ""
      if (b64 === "") throw new Error("Frame encoding produced no data")
      return { b64, encodeMs }
    },
    [],
  )

  const runProbe = useCallback(
    async (runId: number): Promise<void> => {
      const stale = (): boolean => runIdRef.current !== runId
      try {
        const md = navigator.mediaDevices
        if (!md || typeof md.getUserMedia !== "function") {
          throw new Error("Camera not available in this browser")
        }
        const stream = await md.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        })
        if (stale()) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (!video) throw new Error("Preview element not mounted")
        video.srcObject = stream
        await video.play()
        await waitForVideo(video)
        if (stale()) return

        const url = getProbeWsUrl()
        const ws = await openSocket(url)
        if (stale()) {
          ws.close()
          return
        }
        wsRef.current = ws
        setPhase("running")

        const samples: ProbeSample[] = []
        const startedAtIso = new Date().toISOString()
        const t0 = performance.now()
        for (let seq = 0; seq < frames; seq++) {
          if (stale()) return
          // Fresh paint before each capture; single-in-flight — the next frame
          // is only captured after this one's reply lands, mirroring the app.
          await nextAnimationFrame()
          if (stale()) return
          const { b64, encodeMs } = encodeFrame(video)
          const replyPromise = awaitReply(ws)
          const sentAt = performance.now()
          ws.send(JSON.stringify({ frame: b64, exercise: PROBE_EXERCISE }))
          const reply = await replyPromise
          const rtt = performance.now() - sentAt
          if (stale()) return
          if (reply.error !== undefined && reply.code !== undefined) {
            throw new Error(FATAL_CODES[reply.code] ?? reply.error)
          }
          samples.push(buildSample(seq, encodeMs, rtt, reply))
          setCompleted(samples.length)
        }
        const durationMs = performance.now() - t0
        setSummary(
          summarize(samples, {
            url,
            startedAtIso,
            durationMs,
            framesRequested: frames,
            userAgent: navigator.userAgent,
          }),
        )
        setPhase("done")
      } catch (e) {
        if (!stale()) {
          setError(e instanceof Error ? e.message : String(e))
          setPhase("error")
        }
      } finally {
        if (!stale()) {
          activeRef.current = false
          releaseMedia()
        }
      }
    },
    [encodeFrame, frames, releaseMedia, videoRef],
  )

  const start = useCallback((): void => {
    if (activeRef.current) return
    activeRef.current = true
    const runId = ++runIdRef.current
    setError(null)
    setSummary(null)
    setCompleted(0)
    setPhase("preparing")
    void runProbe(runId)
  }, [runProbe])

  const cancel = useCallback((): void => {
    runIdRef.current += 1
    activeRef.current = false
    releaseMedia()
    setPhase("idle")
    setCompleted(0)
  }, [releaseMedia])

  // Never leave the camera or socket running past unmount.
  useEffect(() => {
    return () => {
      runIdRef.current += 1
      activeRef.current = false
      releaseMedia()
    }
  }, [releaseMedia])

  return { phase, completed, total: frames, summary, error, start, cancel }
}
