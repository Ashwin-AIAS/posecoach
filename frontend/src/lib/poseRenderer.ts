/**
 * Pure canvas drawing for the live pose overlay. Every function takes a 2D
 * context plus already-prepared state and renders one effect — no React, no
 * timers, no per-element state. Screen coordinates (already mirrored) are
 * supplied by the caller so text and arcs stay upright.
 */

import type { Particle } from "../hooks/useParticles"
import type { TrailFrame } from "../hooks/usePoseTrail"
import type { Keypoint, RepState } from "../types"
import {
  FORM_UNSCORED,
  SPOTLIGHT_RED,
  confColor,
  darken,
  desaturate,
  lighten,
  scoreColor,
} from "./color"
import { ANGLE_TRIPLETS, CHILD_JOINT_ANGLE, KEYPOINT_COUNT, SKELETON_EDGES } from "./skeleton"

/** A keypoint already projected to canvas pixel space. */
export interface ScreenPoint {
  readonly x: number
  readonly y: number
}

/** Per-frame state shared by the skeleton draw passes. */
export interface OverlayState {
  readonly pts: readonly ScreenPoint[]
  readonly conf: readonly number[]
  readonly jointScores: Readonly<Record<string, number>>
  readonly measuredAngles: Readonly<Record<string, number>>
  /** EMA-smoothed per-joint speed, px/s. */
  readonly velocity: readonly number[]
  /** Keypoint index to spotlight, or null. */
  readonly worstIndex: number | null
  readonly formScore: number | null
  readonly repState: RepState
  /** Fake-depth scale from torso width, clamped to [0.7, 1.4]. */
  readonly depthScale: number
  /** performance.now() at draw time, for time-based pulses. */
  readonly now: number
}

type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const JOINT_CONF_GATE = 0.5
const ARC_RADIUS = 28
const LABEL_OFFSET = 36
const BONE_BASE_WIDTH = 3
const VELOCITY_DIVISOR = 200
const VELOCITY_MAX_BONUS = 3
const SPOTLIGHT_FORM_THRESHOLD = 70 // pulse only when form is poor

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))

/**
 * The CSS `object-cover` transform the live `<video>` uses: the source is
 * scaled up to fully cover the stage and centered, cropping the overflow.
 * Keypoints are normalized to the *full* video frame, so projecting them with
 * plain `nx*W, ny*H` drifts off the body whenever the video's aspect ratio
 * differs from the stage's (always true for a 16:9 back camera in a portrait
 * stage) — see docs/enhancements/FIX_BACK_CAMERA_POSE_QUALITY.md §2E/§5 Phase 3.
 */
export interface CoverProjection {
  readonly dispW: number
  readonly dispH: number
  readonly offX: number
  readonly offY: number
}

export function computeCoverProjection(
  width: number,
  height: number,
  videoWidth: number,
  videoHeight: number,
): CoverProjection {
  if (width <= 0 || height <= 0 || videoWidth <= 0 || videoHeight <= 0) {
    return { dispW: width, dispH: height, offX: 0, offY: 0 }
  }
  const coverScale = Math.max(width / videoWidth, height / videoHeight)
  const dispW = videoWidth * coverScale
  const dispH = videoHeight * coverScale
  return { dispW, dispH, offX: (dispW - width) / 2, offY: (dispH - height) / 2 }
}

/**
 * Hold-last-pose opacity for the steadiness hysteresis (§3C/Phase 3 of
 * docs/enhancements/FIX_POSE_TRACKING_QUALITY.md). During a brief detection gap
 * the overlay keeps blitting the last good skeleton, fading linearly from full
 * to transparent over `holdMs`, so a single dropped frame doesn't flash the
 * skeleton off and on. Returns 1 at the instant of the gap, 0 once the hold
 * window has fully elapsed (or for any non-positive `holdMs`).
 */
export function holdOpacity(elapsedMs: number, holdMs: number): number {
  if (holdMs <= 0 || elapsedMs >= holdMs) return 0
  if (elapsedMs <= 0) return 1
  return clamp(1 - elapsedMs / holdMs, 0, 1)
}

export function screenX(nx: number, proj: CoverProjection, mirrored: boolean): number {
  return (mirrored ? 1 - nx : nx) * proj.dispW - proj.offX
}

export function screenY(ny: number, proj: CoverProjection): number {
  return ny * proj.dispH - proj.offY
}

/**
 * Deliverable #4 — stroboscopic motion trail. Oldest frames first, fading in
 * opacity, joints only (no bones), desaturated confidence color.
 */
export function drawTrail(
  ctx: AnyCtx,
  frames: readonly TrailFrame[],
  proj: CoverProjection,
  mirrored: boolean,
): void {
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    const opacity = 0.08 * (i + 1)
    for (let j = 0; j < KEYPOINT_COUNT; j++) {
      if (frame.conf[j] < JOINT_CONF_GATE) continue
      const [nx, ny] = frame.pts[j] as Keypoint
      ctx.save()
      ctx.globalAlpha = opacity
      ctx.fillStyle = desaturate(confColor(frame.conf[j]), 0.5)
      ctx.beginPath()
      ctx.arc(screenX(nx, proj, mirrored), screenY(ny, proj), 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }
}

/**
 * Deliverables #2, #6, #8 — form-correctness bone color, velocity-modulated
 * width, and bevel (two-stroke) shading for depth.
 */
export function drawBones(ctx: CanvasRenderingContext2D, s: OverlayState): void {
  for (const [a, b] of SKELETON_EDGES) {
    if (s.conf[a] < JOINT_CONF_GATE || s.conf[b] < JOINT_CONF_GATE) continue

    const angleKey = CHILD_JOINT_ANGLE[b]
    const scored = angleKey !== undefined && s.jointScores[angleKey] !== undefined
    const baseColor = scored ? scoreColor(s.jointScores[angleKey as string]) : FORM_UNSCORED

    const v = Math.max(s.velocity[a] ?? 0, s.velocity[b] ?? 0)
    const width = BONE_BASE_WIDTH + clamp(v / VELOCITY_DIVISOR, 0, VELOCITY_MAX_BONUS)

    const ax = s.pts[a].x
    const ay = s.pts[a].y
    const bx = s.pts[b].x
    const by = s.pts[b].y

    ctx.save()
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    if (!scored) ctx.globalAlpha = 0.6

    // Bevel underlay: lighter, full width.
    ctx.strokeStyle = lighten(baseColor, 0.2)
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.stroke()

    // Bevel overlay: darker, slightly thinner, offset down-right.
    ctx.strokeStyle = darken(baseColor, 0.1)
    ctx.lineWidth = Math.max(width - 1, 1)
    ctx.beginPath()
    ctx.moveTo(ax + 1, ay + 1)
    ctx.lineTo(bx + 1, by + 1)
    ctx.stroke()

    ctx.restore()
  }
}

/**
 * Deliverable #5 — angle arc + degree label at each scored joint triplet.
 */
export function drawArcs(ctx: CanvasRenderingContext2D, s: OverlayState): void {
  for (const key of Object.keys(s.jointScores)) {
    const triplet = ANGLE_TRIPLETS[key]
    if (triplet === undefined) continue
    const measured = s.measuredAngles[key]
    if (measured === undefined) continue
    const [a, v, c] = triplet
    if (s.conf[a] < JOINT_CONF_GATE || s.conf[v] < JOINT_CONF_GATE || s.conf[c] < JOINT_CONF_GATE) {
      continue
    }

    const cx = s.pts[v].x
    const cy = s.pts[v].y
    const a1 = Math.atan2(s.pts[a].y - cy, s.pts[a].x - cx)
    const a2 = Math.atan2(s.pts[c].y - cy, s.pts[c].x - cx)
    // Shortest signed sweep from a1 to a2, normalized to (-π, π].
    let delta = a2 - a1
    while (delta <= -Math.PI) delta += Math.PI * 2
    while (delta > Math.PI) delta -= Math.PI * 2
    const color = scoreColor(s.jointScores[key])

    ctx.save()
    ctx.globalAlpha = 0.85
    ctx.strokeStyle = color
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(cx, cy, ARC_RADIUS, a1, a2, delta < 0)
    ctx.stroke()

    // Degree label on the arc's bisector, with a soft black shadow.
    const bisector = a1 + delta / 2
    const lx = cx + LABEL_OFFSET * Math.cos(bisector)
    const ly = cy + LABEL_OFFSET * Math.sin(bisector)
    ctx.globalAlpha = 1
    ctx.font = "12px monospace"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.shadowColor = "#000000"
    ctx.shadowBlur = 2
    ctx.fillStyle = color
    ctx.fillText(`${Math.round(measured)}°`, lx, ly)
    ctx.restore()
  }
}

/**
 * Deliverables #1, #3, #7, #9 — confidence-tinted joints scaled by confidence
 * and fake depth, breathing during the eccentric/hold phase, and the worst-joint
 * spotlight pulse + halo when form is poor.
 */
export function drawJoints(ctx: CanvasRenderingContext2D, s: OverlayState): void {
  // Breathing multiplier applied to all joints (eccentric = "down", hold = plank).
  let breathing = 1
  if (s.repState === "down") {
    breathing = 1 + 0.08 * Math.sin(s.now / 300)
  } else if (s.repState === "hold") {
    breathing = 1 + 0.04 * Math.sin(s.now / 160) // ~1 Hz
  }

  const spotlightActive =
    s.worstIndex !== null && s.formScore !== null && s.formScore < SPOTLIGHT_FORM_THRESHOLD

  for (let i = 0; i < KEYPOINT_COUNT; i++) {
    const conf = s.conf[i]
    let r = (4 + conf * 4) * s.depthScale * breathing
    if (conf < JOINT_CONF_GATE) r *= 0.6 // low-confidence joints shrink 40%

    ctx.save()
    if (spotlightActive && i === s.worstIndex) {
      // 1.0×–1.4× pulse at 2 Hz + red halo.
      r *= 1.2 + 0.2 * Math.sin(s.now / 250)
      ctx.shadowColor = SPOTLIGHT_RED
      ctx.shadowBlur = 20
    }
    ctx.fillStyle = confColor(conf)
    ctx.beginPath()
    ctx.arc(s.pts[i].x, s.pts[i].y, Math.max(r, 0.5), 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

/** Deliverable #10 — rep-completion particle burst with linear fade. */
export function drawParticles(ctx: AnyCtx, particles: readonly Particle[]): void {
  for (const p of particles) {
    ctx.save()
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife)
    ctx.fillStyle = p.color
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}
