import { memo, useEffect, useRef } from "react"

import { useParticles } from "../hooks/useParticles"
import { usePoseTrail } from "../hooks/usePoseTrail"
import { usePoseVelocity } from "../hooks/usePoseVelocity"
import { JOINT_INFO } from "../lib/joints"
import { createPoseInterpolator } from "../lib/poseInterpolator"
import type { OverlayState, ScreenPoint } from "../lib/poseRenderer"
import { computeCoverProjection, drawArcs, drawBones, drawJoints, drawParticles, drawTrail, holdOpacity } from "../lib/poseRenderer"
import { KEYPOINT_COUNT, KP } from "../lib/skeleton"
import type { PoseResult, RepState } from "../types"
import type { WorstJoint } from "../lib/joints"

/** 30fps cap — skip a rAF tick if the previous draw was < this many ms ago. */
const FRAME_MS = 1000 / 30
/**
 * Hold the last good skeleton on screen this long (ms) through a detection gap,
 * fading to transparent, before blanking (§3C/Phase 3). ~400 ms bridges the
 * brief 1–2 frame dropouts that used to flicker the overlay off and on.
 */
const HOLD_LAST_POSE_MS = 400
/** Torso-width samples kept for the fake-depth median (deliverable #9). */
const DEPTH_WINDOW = 30
const DEPTH_MIN = 0.7
const DEPTH_MAX = 1.4
const DEPTH_CONF_GATE = 0.5

interface PoseOverlayProps {
  readonly result: PoseResult | null
  /** Mirror the overlay to match the mirrored front-camera display. */
  readonly mirrored: boolean
  /** Lowest-scoring joint (kept for API compatibility; spotlight uses result.worst_joint). */
  readonly worst?: WorstJoint | null
  /** Hands the live overlay canvas to the session recorder's compositor (§3.3). */
  readonly onCanvasReady?: (canvas: HTMLCanvasElement | null) => void
  /**
   * The displayed `<video>`'s ref. Its `videoWidth`/`videoHeight` are read each
   * draw to project keypoints through the same `object-cover` transform the
   * video itself is displayed with, so the skeleton stays on the body even
   * when the camera's aspect ratio differs from the stage's (back camera).
   */
  readonly videoRef?: React.RefObject<HTMLVideoElement>
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function PoseOverlayInner({ result, mirrored, onCanvasReady, videoRef }: PoseOverlayProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trail = usePoseTrail()
  const velocity = usePoseVelocity()
  const particles = useParticles()

  // Expose the overlay canvas to the recorder compositor (and clear on unmount).
  useEffect(() => {
    onCanvasReady?.(canvasRef.current)
    return () => onCanvasReady?.(null)
  }, [onCanvasReady])

  // Latest props mirrored into refs so the rAF loop never re-subscribes.
  const resultRef = useRef<PoseResult | null>(result)
  const mirroredRef = useRef(mirrored)
  // The video ref *object* itself is stable (created once by useCamera), so it's
  // safe to mirror the prop and read `.current` fresh on every draw below.
  const videoRefPropRef = useRef(videoRef)
  useEffect(() => {
    resultRef.current = result
  }, [result])
  useEffect(() => {
    mirroredRef.current = mirrored
  }, [mirrored])
  useEffect(() => {
    videoRefPropRef.current = videoRef
  }, [videoRef])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Trail layer: OffscreenCanvas in Chrome, a detached <canvas> elsewhere.
    let trailBuf: OffscreenCanvas | HTMLCanvasElement
    let getTrailCtx: () => CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (typeof OffscreenCanvas !== "undefined") {
      const buf = new OffscreenCanvas(1, 1)
      trailBuf = buf
      getTrailCtx = () => buf.getContext("2d")
    } else {
      const buf = document.createElement("canvas")
      trailBuf = buf
      getTrailCtx = () => buf.getContext("2d")
    }

    // Hold-last-pose layer (§3C/Phase 3): snapshot of the last good skeleton,
    // re-blitted with a fading alpha to bridge brief detection gaps.
    let holdBuf: OffscreenCanvas | HTMLCanvasElement
    let getHoldCtx: () => CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (typeof OffscreenCanvas !== "undefined") {
      const buf = new OffscreenCanvas(1, 1)
      holdBuf = buf
      getHoldCtx = () => buf.getContext("2d")
    } else {
      const buf = document.createElement("canvas")
      holdBuf = buf
      getHoldCtx = () => buf.getContext("2d")
    }
    let lastGoodAt = 0 // performance.now() of the last good skeleton snapshot
    let hasLastGood = false

    let raf = 0
    let lastDraw = 0
    let lastTick = performance.now()
    let processed: PoseResult | null = null
    let prevReps = 0
    let prevRepState: RepState | null = null
    const torsoWidths: number[] = []
    let curTorso = 0
    // Reconstructs a smooth render-rate pose from the slower server frame stream
    // so the skeleton glides along the body's path instead of snapping (P-perf).
    const interp = createPoseInterpolator()

    const loop = (): void => {
      raf = requestAnimationFrame(loop)
      const now = performance.now()
      if (now - lastDraw < FRAME_MS) return // 30fps cap
      const dt = now - lastTick
      lastDraw = now
      lastTick = now

      const rect = canvas.getBoundingClientRect()
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width
        canvas.height = rect.height
      }
      const W = canvas.width
      const H = canvas.height
      ctx.clearRect(0, 0, W, H)

      // Particles animate every frame, even between (or after) WS messages.
      const liveParticles = particles.update(dt)

      const res = resultRef.current
      const mir = mirroredRef.current
      if (res === null || res.keypoints.length !== KEYPOINT_COUNT) {
        // Hold-last-pose hysteresis (§3C/Phase 3): a single dropped/again-detected
        // frame must NOT blank the skeleton. Keep blitting the last good snapshot,
        // fading to 0 over HOLD_LAST_POSE_MS, before clearing — and defer
        // interp.reset() until the hold expires so a quick re-detection resumes
        // smoothly instead of snapping across the gap.
        const opacity = hasLastGood ? holdOpacity(now - lastGoodAt, HOLD_LAST_POSE_MS) : 0
        if (opacity > 0 && holdBuf.width === W && holdBuf.height === H) {
          ctx.save()
          ctx.globalAlpha = opacity
          ctx.drawImage(holdBuf, 0, 0)
          ctx.restore()
        } else if (hasLastGood) {
          hasLastGood = false
          interp.reset() // gap outlived the hold — stop interpolating across it
        }
        drawParticles(ctx, liveParticles)
        return
      }

      const conf = res.confidence

      // Feed each freshly-arrived server frame to the interpolator, then sample
      // the pose for `now`: this turns the ~6–15 Hz server stream into motion
      // drawn at the rAF rate, so the skeleton glides instead of snapping.
      const isNew = res !== processed
      if (isNew) interp.push(res.keypoints, conf, now)
      const sampled = interp.sample(now)
      const renderKp = sampled ? sampled.keypoints : res.keypoints

      const videoEl = videoRefPropRef.current?.current ?? null
      const proj = computeCoverProjection(W, H, videoEl?.videoWidth ?? W, videoEl?.videoHeight ?? H)

      const pts: ScreenPoint[] = renderKp.map(([x, y]) => ({
        x: (mir ? 1 - x : x) * proj.dispW - proj.offX,
        y: y * proj.dispH - proj.offY,
      }))

      // Process side effects only when a genuinely new frame arrives (identity
      // changes per WS message), so trails/velocity/particles don't double-fire
      // while the loop re-renders a frozen frame after a disconnect.
      if (isNew) {
        processed = res
        velocity.update(pts, now)

        // Fake-depth torso width (pixels).
        if (conf[KP.LEFT_SHOULDER] >= DEPTH_CONF_GATE && conf[KP.RIGHT_SHOULDER] >= DEPTH_CONF_GATE) {
          curTorso = Math.hypot(
            pts[KP.LEFT_SHOULDER].x - pts[KP.RIGHT_SHOULDER].x,
            pts[KP.LEFT_SHOULDER].y - pts[KP.RIGHT_SHOULDER].y,
          )
          torsoWidths.push(curTorso)
          if (torsoWidths.length > DEPTH_WINDOW) torsoWidths.shift()
        }

        const repState = res.rep_state ?? null
        // Wipe trail at the start of each eccentric so streaks don't pile up.
        if (prevRepState === "up" && repState === "down") trail.reset()
        prevRepState = repState
        trail.push({
          pts: res.keypoints.map(([x, y]) => [x, y] as const),
          conf: [...conf],
        })

        // Particle burst on each rep increment (single fire — guarded by count).
        const reps = res.reps ?? 0
        if (reps > prevReps) {
          const key = res.worst_joint ?? null
          const widx = key !== null ? JOINT_INFO[key]?.keypointIndex : undefined
          const anchor = widx !== undefined ? pts[widx] : pts[KP.LEFT_HIP]
          particles.spawn(anchor.x, anchor.y, res.score)
        }
        prevReps = reps
      }

      const med = median(torsoWidths)
      const depthScale = med > 0 ? Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, curTorso / med)) : 1

      const key = res.worst_joint ?? null
      const worstIndex = key !== null ? (JOINT_INFO[key]?.keypointIndex ?? null) : null

      const state: OverlayState = {
        pts,
        conf,
        jointScores: res.joint_scores ?? {},
        measuredAngles: res.measured_angles ?? {},
        velocity: velocity.get(),
        worstIndex,
        formScore: res.score,
        repState: res.rep_state ?? "up",
        depthScale,
        now,
      }

      // Trail first (under everything), composited from its own layer.
      const frames = trail.get()
      if (frames.length > 0) {
        if (trailBuf.width !== W) trailBuf.width = W
        if (trailBuf.height !== H) trailBuf.height = H
        const tctx = getTrailCtx()
        if (tctx) {
          tctx.clearRect(0, 0, W, H)
          drawTrail(tctx, frames, proj, mir)
          ctx.drawImage(trailBuf, 0, 0)
        }
      }

      drawBones(ctx, state)
      drawArcs(ctx, state)
      drawJoints(ctx, state)

      // Snapshot this good skeleton (trail+bones+arcs+joints, no live particles)
      // so a brief detection gap can hold it on screen, fading, instead of
      // flickering to black (§3C/Phase 3).
      if (holdBuf.width !== W) holdBuf.width = W
      if (holdBuf.height !== H) holdBuf.height = H
      const hctx = getHoldCtx()
      if (hctx) {
        hctx.clearRect(0, 0, W, H)
        hctx.drawImage(canvas, 0, 0)
        lastGoodAt = now
        hasLastGood = true
      }

      drawParticles(ctx, liveParticles)
    }

    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      trail.reset()
      velocity.reset()
      particles.reset()
    }
  }, [trail, velocity, particles])

  return (
    <canvas
      ref={canvasRef}
      data-testid="pose-overlay"
      className="absolute inset-0 h-full w-full pointer-events-none"
      aria-hidden="true"
    />
  )
}

export const PoseOverlay = memo(PoseOverlayInner)
