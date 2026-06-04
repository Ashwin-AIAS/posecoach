import { memo, useEffect, useRef } from "react"

import { useParticles } from "../hooks/useParticles"
import { usePoseTrail } from "../hooks/usePoseTrail"
import { usePoseVelocity } from "../hooks/usePoseVelocity"
import { JOINT_INFO } from "../lib/joints"
import type { OverlayState, ScreenPoint } from "../lib/poseRenderer"
import { drawArcs, drawBones, drawJoints, drawParticles, drawTrail } from "../lib/poseRenderer"
import { KEYPOINT_COUNT, KP } from "../lib/skeleton"
import type { PoseResult, RepState } from "../types"
import type { WorstJoint } from "../lib/joints"

/** 30fps cap — skip a rAF tick if the previous draw was < this many ms ago. */
const FRAME_MS = 1000 / 30
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
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function PoseOverlayInner({ result, mirrored, onCanvasReady }: PoseOverlayProps): JSX.Element {
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
  useEffect(() => {
    resultRef.current = result
  }, [result])
  useEffect(() => {
    mirroredRef.current = mirrored
  }, [mirrored])

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

    let raf = 0
    let lastDraw = 0
    let lastTick = performance.now()
    let processed: PoseResult | null = null
    let prevReps = 0
    let prevRepState: RepState | null = null
    const torsoWidths: number[] = []
    let curTorso = 0

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
        drawParticles(ctx, liveParticles)
        return
      }

      const conf = res.confidence
      const pts: ScreenPoint[] = res.keypoints.map(([x, y]) => ({
        x: (mir ? 1 - x : x) * W,
        y: y * H,
      }))

      // Process side effects only when a genuinely new frame arrives (identity
      // changes per WS message), so trails/velocity/particles don't double-fire
      // while the loop re-renders a frozen frame after a disconnect.
      const isNew = res !== processed
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
          drawTrail(tctx, frames, W, H, mir)
          ctx.drawImage(trailBuf, 0, 0)
        }
      }

      drawBones(ctx, state)
      drawArcs(ctx, state)
      drawJoints(ctx, state)
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
