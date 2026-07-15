import { useCallback, useEffect, useRef, useState } from "react"
import ortJsepWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url"

import type { ProbeReply, StageStats } from "./useLatencyProbe"
import { awaitReply, getProbeWsUrl, openSocket, stageStats } from "./useLatencyProbe"

/**
 * On-device inference PoC (P32 — LATENCY_OPTIMIZATION_PLAN.md Phase 2 §2).
 *
 * The P31 probe proved the deployed round-trip is ~80% network (210 ms of
 * 269 ms p50; server dead-stable at ~58 ms). This hook measures the alternative:
 * run the SAME 640 ONNX in the browser via onnxruntime-web — WebGPU EP first,
 * wasm (SIMD) fallback — and report ms/frame p50/p95 plus a one-frame keypoint
 * parity check against the live server.
 *
 * Preprocessing reproduces the server pipeline exactly (runner._decode_frame +
 * OnnxPoseSession.predict): letterbox to 640 with gray-114 padding, /255,
 * CHW float32 — and crucially in **BGR channel order**: the server receives RGB
 * but flips to BGR before the graph (onnx_session.py, parity MAD ~0 vs .pt), so
 * BGR is what this model actually consumes. No NMS anywhere — the one-to-one
 * head's (1, 300, 57) output is decoded directly, argmax over the score column.
 *
 * Additive only: no frozen camera/pose file is imported or modified.
 */

export const POC_FRAME_COUNT = 50
const WARMUP_RUNS = 3
const MODEL_URL = "/api/v1/model/pose.onnx"
const MODEL_SIZE = 640
const PAD_GRAY = 114
// Top-person detection gate — matches OnnxPoseSession._DETECTION_CONF_THRESHOLD.
const DETECTION_CONF = 0.1
// Per-joint confidence gate (downstream scorer contract) — used for the parity check.
const KP_CONF_GATE = 0.5
// One-to-one head output: [x1, y1, x2, y2, score, class] + 17 * (x, y, conf).
const COLS = 57
const SCORE_COL = 4
const PREFIX_COLS = 6
const KP_COUNT = 17
// The parity frame mirrors the app's normal WS capture profile so the server
// sees exactly what a live session would send.
const SANITY_LONG_SIDE = 512
const SANITY_JPEG_QUALITY = 0.6
const SETUP_TIMEOUT_MS = 10_000

// ── Pure helpers (exported for unit tests) ───────────────────────────────────

/** Mirror of runner._decode_frame's letterbox geometry (round + floor-centred pad). */
export interface LetterboxMeta {
  readonly scale: number
  readonly padX: number
  readonly padY: number
  readonly newW: number
  readonly newH: number
  readonly srcW: number
  readonly srcH: number
}

export function computeLetterbox(srcW: number, srcH: number, size: number): LetterboxMeta {
  const scale = Math.min(size / srcW, size / srcH)
  const newW = Math.max(1, Math.round(srcW * scale))
  const newH = Math.max(1, Math.round(srcH * scale))
  return {
    scale,
    padX: Math.floor((size - newW) / 2),
    padY: Math.floor((size - newH) / 2),
    newW,
    newH,
    srcW,
    srcH,
  }
}

/**
 * RGBA ImageData → (1,3,H,W) float32 in **BGR** order, /255.
 *
 * BGR is deliberate server parity: OnnxPoseSession flips RGB→BGR before the
 * graph because the fine-tune consumed Ultralytics' BGR numpy path — feeding
 * RGB here would be a silent accuracy regression the parity check would catch.
 */
export function imageDataToTensor(img: Pick<ImageData, "data" | "width" | "height">): Float32Array {
  const { data, width, height } = img
  const n = width * height
  const out = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) {
    out[i] = data[i * 4 + 2] / 255 // B
    out[n + i] = data[i * 4 + 1] / 255 // G
    out[2 * n + i] = data[i * 4] / 255 // R
  }
  return out
}

export interface Keypoint640 {
  readonly x: number
  readonly y: number
  readonly conf: number
}

export interface TopPerson {
  readonly conf: number
  /** 17 keypoints in model-input pixel space (640-square, letterboxed). */
  readonly kps: readonly Keypoint640[]
}

/** Decode the (300, 57) one-to-one head: argmax score, gate, slice keypoints. No NMS. */
export function decodeTopPerson(det: Float32Array): TopPerson | null {
  const rows = Math.floor(det.length / COLS)
  if (rows === 0) return null
  let best = 0
  let bestConf = -Infinity
  for (let r = 0; r < rows; r++) {
    const c = det[r * COLS + SCORE_COL]
    if (c > bestConf) {
      bestConf = c
      best = r
    }
  }
  if (bestConf < DETECTION_CONF) return null
  const kps: Keypoint640[] = []
  for (let k = 0; k < KP_COUNT; k++) {
    const o = best * COLS + PREFIX_COLS + k * 3
    kps.push({ x: det[o], y: det[o + 1], conf: det[o + 2] })
  }
  return { conf: bestConf, kps }
}

export interface NormKeypoint {
  readonly xn: number
  readonly yn: number
  readonly conf: number
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/** Mirror of runner._unletterbox_xyn: 640-px space → normalized source-frame coords. */
export function unletterboxToNorm(
  kps: readonly Keypoint640[],
  meta: LetterboxMeta,
): NormKeypoint[] {
  return kps.map((k) => ({
    xn: clamp01((k.x - meta.padX) / meta.newW),
    yn: clamp01((k.y - meta.padY) / meta.newH),
    conf: k.conf,
  }))
}

/**
 * Mean pixel distance between local and server keypoints (both normalized to
 * the same sent frame), over joints where BOTH sides clear the 0.5 joint gate.
 */
export function meanPixelDelta(
  local: readonly NormKeypoint[],
  serverKps: readonly (readonly number[])[],
  serverConf: readonly number[],
  frameW: number,
  frameH: number,
): { readonly meanPx: number; readonly joints: number } | null {
  let sum = 0
  let n = 0
  const count = Math.min(local.length, serverKps.length)
  for (let i = 0; i < count; i++) {
    const sc = serverConf[i] ?? 0
    if (local[i].conf < KP_CONF_GATE || sc < KP_CONF_GATE) continue
    const [sx, sy] = serverKps[i]
    sum += Math.hypot((local[i].xn - sx) * frameW, (local[i].yn - sy) * frameH)
    n += 1
  }
  if (n === 0) return null
  return { meanPx: Math.round((sum / n) * 10) / 10, joints: n }
}

const round1 = (v: number): number => Math.round(v * 10) / 10

// ── Result types ─────────────────────────────────────────────────────────────

export interface PocSample {
  readonly seq: number
  readonly preprocess_ms: number
  readonly inference_ms: number
  readonly detected: boolean
}

export interface SanityResult {
  readonly mean_px_delta: number | null
  readonly joints_compared: number
  readonly frame_w: number
  readonly frame_h: number
  readonly local_top_conf: number | null
  readonly server_status: string
  readonly server_latency_ms: number | null
  readonly error: string | null
}

export interface PocSummary {
  readonly kind: "ondevice_inference_poc"
  readonly started_at: string
  readonly user_agent: string
  readonly model_url: string
  readonly model_bytes: number
  readonly ep_used: "webgpu" | "wasm"
  readonly webgpu_available: boolean
  readonly wasm_threads: number
  readonly model_fetch_ms: number
  readonly session_create_ms: number
  readonly warmup_first_run_ms: number
  readonly frames: number
  readonly detected_frames: number
  readonly stages: {
    readonly preprocess: StageStats
    readonly inference: StageStats
    readonly total: StageStats
  }
  readonly fps_inference_only: number
  readonly sanity: SanityResult
  readonly samples: readonly PocSample[]
}

// The parity check reads keypoints/confidence off the standard WS reply.
interface SanityReply extends ProbeReply {
  readonly keypoints?: readonly (readonly number[])[]
  readonly confidence?: readonly number[]
}

// ── The hook ─────────────────────────────────────────────────────────────────

export type PocPhase = "idle" | "loading" | "running" | "sanity" | "done" | "error"

export interface UseOnDeviceInferenceResult {
  readonly phase: PocPhase
  /** Human-readable sub-step while phase === "loading" (fetch / session / warmup). */
  readonly step: string
  readonly completed: number
  readonly total: number
  readonly summary: PocSummary | null
  readonly error: string | null
  readonly start: () => void
  readonly cancel: () => void
}

function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
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

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

/**
 * Runs the on-device PoC against the given preview `<video>`. Owns the camera
 * stream, the ORT session, and (briefly) a WS connection for the parity check;
 * all are released when the run ends, errors, is cancelled, or unmounts.
 */
export function useOnDeviceInference(
  videoRef: React.RefObject<HTMLVideoElement>,
  frames: number = POC_FRAME_COUNT,
): UseOnDeviceInferenceResult {
  const [phase, setPhase] = useState<PocPhase>("idle")
  const [step, setStep] = useState("")
  const [completed, setCompleted] = useState(0)
  const [summary, setSummary] = useState<PocSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runIdRef = useRef(0)
  const activeRef = useRef(false)
  const streamRef = useRef<MediaStream | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  // ORT session held loosely: the module is loaded dynamically so tests and the
  // main bundle never pay for it; `release()` is the only call made from here.
  const sessionRef = useRef<{ release: () => Promise<void> } | null>(null)

  const releaseAll = useCallback((): void => {
    const ws = wsRef.current
    wsRef.current = null
    if (ws !== null && ws.readyState <= WebSocket.OPEN) ws.close()
    const stream = streamRef.current
    streamRef.current = null
    stream?.getTracks().forEach((t) => t.stop())
    const video = videoRef.current
    if (video) video.srcObject = null
    const session = sessionRef.current
    sessionRef.current = null
    if (session) void session.release().catch(() => undefined)
  }, [videoRef])

  const runPoc = useCallback(
    async (runId: number): Promise<void> => {
      const stale = (): boolean => runIdRef.current !== runId
      try {
        // 1. Fetch the exact model file the Space serves (same-origin route).
        setStep("Fetching model…")
        const t0 = performance.now()
        const res = await fetch(MODEL_URL)
        if (!res.ok) {
          throw new Error(
            `Model endpoint returned ${res.status} — is the server running an ONNX model?`,
          )
        }
        const modelBytes = new Uint8Array(await res.arrayBuffer())
        const modelFetchMs = performance.now() - t0
        if (stale()) return

        // 2. Load ORT lazily (code-split chunk) and create the session:
        //    WebGPU EP first, wasm (SIMD) fallback. Threads stay at 1 — the app
        //    is not cross-origin-isolated (COEP would break the exercise-image
        //    CDNs), so multithreaded wasm is unavailable by design.
        setStep("Loading onnxruntime-web…")
        const ort = await import("onnxruntime-web/webgpu")
        ort.env.wasm.wasmPaths = { wasm: ortJsepWasmUrl }
        ort.env.wasm.numThreads = 1
        if (stale()) return

        const webgpuAvailable = typeof navigator !== "undefined" && "gpu" in navigator
        let epUsed: "webgpu" | "wasm" = "wasm"
        let session: Awaited<ReturnType<typeof ort.InferenceSession.create>> | null = null
        const t1 = performance.now()
        if (webgpuAvailable) {
          setStep("Creating session (webgpu)…")
          try {
            session = await ort.InferenceSession.create(modelBytes, {
              executionProviders: ["webgpu"],
            })
            epUsed = "webgpu"
          } catch {
            session = null // fall through to wasm below
          }
        }
        if (session === null) {
          setStep("Creating session (wasm)…")
          session = await ort.InferenceSession.create(modelBytes, {
            executionProviders: ["wasm"],
          })
          epUsed = "wasm"
        }
        const sessionCreateMs = performance.now() - t1
        const liveSession = session
        sessionRef.current = liveSession
        if (stale()) return

        // 3. Camera (own stream — the frozen live-flow hooks are not touched).
        setStep("Starting camera…")
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
        await waitForVideoReady(video)
        if (stale()) return

        // Shared 640×640 letterbox canvas, gray-114 padded like the server.
        const canvas = document.createElement("canvas")
        canvas.width = MODEL_SIZE
        canvas.height = MODEL_SIZE
        const ctx = canvas.getContext("2d", { willReadFrequently: true })
        if (!ctx) throw new Error("Canvas 2D context unavailable")

        const letterboxFrom = (
          source: CanvasImageSource,
          srcW: number,
          srcH: number,
        ): LetterboxMeta => {
          const meta = computeLetterbox(srcW, srcH, MODEL_SIZE)
          ctx.fillStyle = `rgb(${PAD_GRAY},${PAD_GRAY},${PAD_GRAY})`
          ctx.fillRect(0, 0, MODEL_SIZE, MODEL_SIZE)
          ctx.drawImage(source, 0, 0, srcW, srcH, meta.padX, meta.padY, meta.newW, meta.newH)
          return meta
        }

        const runTensor = async (): Promise<Float32Array> => {
          const img = ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE)
          const tensor = new ort.Tensor("float32", imageDataToTensor(img), [
            1,
            3,
            MODEL_SIZE,
            MODEL_SIZE,
          ])
          const out = await liveSession.run({ [liveSession.inputNames[0]]: tensor })
          return out[liveSession.outputNames[0]].data as Float32Array
        }

        const inferVideoFrame = async (): Promise<{
          preMs: number
          inferMs: number
          top: TopPerson | null
        }> => {
          const vw = video.videoWidth || 640
          const vh = video.videoHeight || 480
          const p0 = performance.now()
          letterboxFrom(video, vw, vh)
          const img = ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE)
          const tensor = new ort.Tensor("float32", imageDataToTensor(img), [
            1,
            3,
            MODEL_SIZE,
            MODEL_SIZE,
          ])
          const p1 = performance.now()
          const out = await liveSession.run({ [liveSession.inputNames[0]]: tensor })
          const p2 = performance.now()
          const det = out[liveSession.outputNames[0]].data as Float32Array
          return { preMs: p1 - p0, inferMs: p2 - p1, top: decodeTopPerson(det) }
        }

        // 4. Warm-up (shader compile on webgpu / wasm JIT) — excluded from stats.
        setStep("Warming up…")
        let warmupFirstMs = 0
        for (let w = 0; w < WARMUP_RUNS; w++) {
          const r = await inferVideoFrame()
          if (w === 0) warmupFirstMs = r.inferMs
          if (stale()) return
        }

        // 5. Timed loop — ~50 frames, sequential (nothing else in flight).
        setPhase("running")
        const startedAtIso = new Date().toISOString()
        const samples: PocSample[] = []
        for (let seq = 0; seq < frames; seq++) {
          if (stale()) return
          await nextAnimationFrame()
          if (stale()) return
          const r = await inferVideoFrame()
          samples.push({
            seq,
            preprocess_ms: round1(r.preMs),
            inference_ms: round1(r.inferMs),
            detected: r.top !== null,
          })
          setCompleted(samples.length)
        }

        // 6. One-frame keypoint parity vs the live server: encode ONE JPEG at
        //    the app's capture profile and run it through BOTH pipelines. The
        //    WS connection is fresh, so the server's EMA smoother is identity
        //    on this first frame — raw model output on both sides.
        setPhase("sanity")
        setStep("Checking keypoint parity vs server…")
        const sanity = await (async (): Promise<SanityResult> => {
          const fail = (msg: string): SanityResult => ({
            mean_px_delta: null,
            joints_compared: 0,
            frame_w: 0,
            frame_h: 0,
            local_top_conf: null,
            server_status: "n/a",
            server_latency_ms: null,
            error: msg,
          })
          try {
            const vw = video.videoWidth || 640
            const vh = video.videoHeight || 480
            const jScale = SANITY_LONG_SIDE / Math.max(vw, vh)
            const jw = Math.max(1, Math.round(vw * jScale))
            const jh = Math.max(1, Math.round(vh * jScale))
            const jpegCanvas = document.createElement("canvas")
            jpegCanvas.width = jw
            jpegCanvas.height = jh
            const jctx = jpegCanvas.getContext("2d")
            if (!jctx) return fail("canvas unavailable")
            jctx.drawImage(video, 0, 0, jw, jh)
            const dataUrl = jpegCanvas.toDataURL("image/jpeg", SANITY_JPEG_QUALITY)
            const b64 = dataUrl.split(",", 2)[1] ?? ""
            if (b64 === "") return fail("JPEG encoding produced no data")

            // Local: decode the SAME JPEG (not the raw video frame) so both
            // sides see bit-identical input.
            const jpegImg = new Image()
            jpegImg.src = dataUrl
            await jpegImg.decode()
            const meta = letterboxFrom(jpegImg, jw, jh)
            const localTop = decodeTopPerson(await runTensor())
            if (localTop === null) {
              return fail("no person detected locally — stand in frame and rerun")
            }
            const localNorm = unletterboxToNorm(localTop.kps, meta)

            // Server: same base64 over a fresh WS connection.
            const ws = await openSocket(getProbeWsUrl())
            wsRef.current = ws
            const replyPromise = awaitReply(ws)
            ws.send(JSON.stringify({ frame: b64, exercise: "squat" }))
            const reply = (await replyPromise) as SanityReply
            ws.close()
            wsRef.current = null
            if (reply.error !== undefined) return fail(`server: ${reply.error}`)
            const status = reply.status ?? "ok"
            if (!Array.isArray(reply.keypoints) || reply.keypoints.length === 0) {
              return fail(`server returned no keypoints (status: ${status})`)
            }
            const delta = meanPixelDelta(localNorm, reply.keypoints, reply.confidence ?? [], jw, jh)
            return {
              mean_px_delta: delta?.meanPx ?? null,
              joints_compared: delta?.joints ?? 0,
              frame_w: jw,
              frame_h: jh,
              local_top_conf: Math.round(localTop.conf * 1000) / 1000,
              server_status: status,
              server_latency_ms: typeof reply.latency_ms === "number" ? reply.latency_ms : null,
              error: delta === null ? "no joint cleared the 0.5 gate on both sides" : null,
            }
          } catch (e) {
            return fail(e instanceof Error ? e.message : String(e))
          }
        })()
        if (stale()) return

        const pre = samples.map((s) => s.preprocess_ms)
        const inf = samples.map((s) => s.inference_ms)
        const tot = samples.map((s) => s.preprocess_ms + s.inference_ms)
        const totalStats = stageStats(tot)
        setSummary({
          kind: "ondevice_inference_poc",
          started_at: startedAtIso,
          user_agent: navigator.userAgent,
          model_url: MODEL_URL,
          model_bytes: modelBytes.byteLength,
          ep_used: epUsed,
          webgpu_available: webgpuAvailable,
          wasm_threads: 1,
          model_fetch_ms: round1(modelFetchMs),
          session_create_ms: round1(sessionCreateMs),
          warmup_first_run_ms: round1(warmupFirstMs),
          frames: samples.length,
          detected_frames: samples.filter((s) => s.detected).length,
          stages: {
            preprocess: stageStats(pre),
            inference: stageStats(inf),
            total: totalStats,
          },
          fps_inference_only: totalStats.mean_ms > 0 ? round1(1000 / totalStats.mean_ms) : 0,
          sanity,
          samples,
        })
        setPhase("done")
      } catch (e) {
        if (!stale()) {
          setError(e instanceof Error ? e.message : String(e))
          setPhase("error")
        }
      } finally {
        if (!stale()) {
          activeRef.current = false
          releaseAll()
        }
      }
    },
    [frames, releaseAll, videoRef],
  )

  const start = useCallback((): void => {
    if (activeRef.current) return
    activeRef.current = true
    const runId = ++runIdRef.current
    setError(null)
    setSummary(null)
    setCompleted(0)
    setStep("")
    setPhase("loading")
    void runPoc(runId)
  }, [runPoc])

  const cancel = useCallback((): void => {
    runIdRef.current += 1
    activeRef.current = false
    releaseAll()
    setPhase("idle")
    setCompleted(0)
    setStep("")
  }, [releaseAll])

  useEffect(() => {
    return () => {
      runIdRef.current += 1
      activeRef.current = false
      releaseAll()
    }
  }, [releaseAll])

  return { phase, step, completed, total: frames, summary, error, start, cancel }
}
