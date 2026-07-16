/**
 * Draws the neon skeleton: bones, keypoint nodes, and joint-angle arcs
 * (UI-11 §3.3, §4.3 steps 3-5, §4.4 cheap glow). Pure canvas drawing —
 * reads an already-projected `ScreenFrame`, computes nothing about form.
 */
import { angle as interiorAngle, arcLabelPoint, arcSweep, toCanvasXY } from "./geometry"
import type { CoverProjection, Point2D } from "./geometry"
import { OVERLAY, bandFromScore, hexToRgba, qualityColor } from "./overlayTheme"
import type { JointQuality } from "./overlayTheme"
import type { OverlayAngleKey, OverlayFrame, OverlayJointKey } from "./types"

// COCO-17 indices (§3.3) — a fixed, well-known layout; kept local so this
// feature has zero dependency on the frozen lib/skeleton.ts.
const NOSE = 0
const L_EYE = 1
const R_EYE = 2
const L_EAR = 3
const R_EAR = 4
const L_SHOULDER = 5
const R_SHOULDER = 6
const L_ELBOW = 7
const R_ELBOW = 8
const L_WRIST = 9
const R_WRIST = 10
const L_HIP = 11
const R_HIP = 12
const L_KNEE = 13
const R_KNEE = 14
const L_ANKLE = 15
const R_ANKLE = 16

const MAJOR_JOINTS: ReadonlySet<number> = new Set([
  L_SHOULDER,
  R_SHOULDER,
  L_HIP,
  R_HIP,
  L_KNEE,
  R_KNEE,
])

const SEVERITY: Readonly<Record<JointQuality, number>> = { base: 0, good: 1, warn: 2, error: 3 }

function worstOf(a: JointQuality, b: JointQuality): JointQuality {
  return SEVERITY[a] >= SEVERITY[b] ? a : b
}

type QualityMap = Partial<Record<OverlayJointKey, JointQuality>>

function qualityOf(quality: QualityMap, key: OverlayJointKey): JointQuality {
  return quality[key] ?? "base"
}

interface Bone {
  readonly a: number
  readonly b: number
  readonly quality: (q: QualityMap) => JointQuality
  readonly spine: boolean
}

const FACE_BONES: ReadonlyArray<readonly [number, number]> = [
  [NOSE, L_EYE],
  [NOSE, R_EYE],
  [L_EYE, L_EAR],
  [R_EYE, R_EAR],
]

const BONES: readonly Bone[] = [
  { a: L_SHOULDER, b: L_ELBOW, quality: (q) => qualityOf(q, "lElbow"), spine: false },
  { a: L_ELBOW, b: L_WRIST, quality: (q) => qualityOf(q, "lElbow"), spine: false },
  { a: R_SHOULDER, b: R_ELBOW, quality: (q) => qualityOf(q, "rElbow"), spine: false },
  { a: R_ELBOW, b: R_WRIST, quality: (q) => qualityOf(q, "rElbow"), spine: false },
  { a: L_SHOULDER, b: R_SHOULDER, quality: (q) => qualityOf(q, "spine"), spine: true },
  { a: L_SHOULDER, b: L_HIP, quality: (q) => qualityOf(q, "spine"), spine: true },
  { a: R_SHOULDER, b: R_HIP, quality: (q) => qualityOf(q, "spine"), spine: true },
  { a: L_HIP, b: R_HIP, quality: (q) => qualityOf(q, "spine"), spine: true },
  {
    a: L_HIP,
    b: L_KNEE,
    quality: (q) => worstOf(qualityOf(q, "lHip"), qualityOf(q, "lKnee")),
    spine: false,
  },
  { a: L_KNEE, b: L_ANKLE, quality: (q) => qualityOf(q, "lKnee"), spine: false },
  {
    a: R_HIP,
    b: R_KNEE,
    quality: (q) => worstOf(qualityOf(q, "rHip"), qualityOf(q, "rKnee")),
    spine: false,
  },
  { a: R_KNEE, b: R_ANKLE, quality: (q) => qualityOf(q, "rKnee"), spine: false },
]

/** Keypoint index -> the scored-angle key whose quality colors that node (vertex joints only). */
const NODE_QUALITY_KEY: Partial<Record<number, OverlayJointKey>> = {
  [L_ELBOW]: "lElbow",
  [R_ELBOW]: "rElbow",
  [L_HIP]: "lHip",
  [R_HIP]: "rHip",
  [L_KNEE]: "lKnee",
  [R_KNEE]: "rKnee",
}

interface Arc {
  readonly key: OverlayAngleKey
  readonly a: number
  readonly vertex: number
  readonly c: number
  readonly radius: number
}

const ARCS: readonly Arc[] = [
  { key: "lKnee", a: L_HIP, vertex: L_KNEE, c: L_ANKLE, radius: OVERLAY.arc.rKnee },
  { key: "rKnee", a: R_HIP, vertex: R_KNEE, c: R_ANKLE, radius: OVERLAY.arc.rKnee },
  { key: "lHip", a: L_SHOULDER, vertex: L_HIP, c: L_KNEE, radius: OVERLAY.arc.rHip },
  { key: "rHip", a: R_SHOULDER, vertex: R_HIP, c: R_KNEE, radius: OVERLAY.arc.rHip },
  { key: "lElbow", a: L_SHOULDER, vertex: L_ELBOW, c: L_WRIST, radius: OVERLAY.arc.rElbow },
  { key: "rElbow", a: R_SHOULDER, vertex: R_ELBOW, c: R_WRIST, radius: OVERLAY.arc.rElbow },
]

type AnyCtx = CanvasRenderingContext2D

/** Resolves each keypoint's quality band, falling back to the global score band, then base. */
function effectiveQuality(frame: OverlayFrame): QualityMap {
  if (frame.jointQuality !== undefined) return frame.jointQuality
  if (frame.formScore === null) return {}
  const band = bandFromScore(frame.formScore)
  const all: QualityMap = { lElbow: band, rElbow: band, lHip: band, rHip: band, lKnee: band, rKnee: band, spine: band }
  return all
}

/** Two-pass "core-and-underlay" glow stroke — cheap alternative to shadowBlur (§4.4). */
function strokeGlowLine(ctx: AnyCtx, from: Point2D, to: Point2D, color: string, width: number): void {
  ctx.lineCap = "round"
  ctx.strokeStyle = hexToRgba(color, OVERLAY.glow.underlayAlpha)
  ctx.lineWidth = width + 7
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()

  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()
}

/** Screen-space points for all 17 keypoints, `null` where the source keypoint was absent. */
export function projectKeypoints(
  frame: OverlayFrame,
  mirrored: boolean,
  proj: CoverProjection,
): readonly (Point2D | null)[] {
  return frame.keypoints.map((kp) => (kp === null ? null : toCanvasXY(kp.x, kp.y, mirrored, proj)))
}

export function drawBones(ctx: AnyCtx, frame: OverlayFrame, pts: readonly (Point2D | null)[]): void {
  const quality = effectiveQuality(frame)

  for (const [a, b] of FACE_BONES) {
    const pa = pts[a]
    const pb = pts[b]
    if (pa === null || pb === null) continue
    strokeGlowLine(ctx, pa, pb, OVERLAY.color.base, OVERLAY.bone.width * 0.6)
  }

  for (const bone of BONES) {
    const pa = pts[bone.a]
    const pb = pts[bone.b]
    if (pa === null || pb === null) continue
    const color = qualityColor(bone.quality(quality))
    const width = bone.spine ? OVERLAY.bone.spineWidth : OVERLAY.bone.width
    strokeGlowLine(ctx, pa, pb, color, width)
  }
}

export function drawArcs(ctx: AnyCtx, frame: OverlayFrame, pts: readonly (Point2D | null)[]): void {
  const quality = effectiveQuality(frame)

  for (const arc of ARCS) {
    const pa = pts[arc.a]
    const pv = pts[arc.vertex]
    const pc = pts[arc.c]
    if (pa === null || pv === null || pc === null) continue

    const q = quality[arc.key] ?? "base"
    const color = qualityColor(q)
    const sweep = arcSweep(pa, pv, pc)

    ctx.strokeStyle = color
    ctx.lineWidth = OVERLAY.arc.width
    ctx.lineCap = "round"
    ctx.beginPath()
    ctx.arc(pv.x, pv.y, arc.radius, sweep.startAngle, sweep.endAngle, sweep.anticlockwise)
    ctx.stroke()

    const degrees = frame.angles?.[arc.key] ?? interiorAngle(pa, pv, pc)
    const label = arcLabelPoint(pa, pv, pc, arc.radius + OVERLAY.arc.labelOffset)
    drawDegreePill(ctx, label, Math.round(degrees), color)
  }
}

function drawDegreePill(ctx: AnyCtx, at: Point2D, degrees: number, color: string): void {
  const text = `${degrees}°`
  ctx.font = "600 11px Inter, system-ui, sans-serif"
  const metrics = ctx.measureText(text)
  const padX = 6
  const w = metrics.width + padX * 2
  const h = 16

  ctx.fillStyle = OVERLAY.color.chipBg
  ctx.beginPath()
  roundRect(ctx, at.x - w / 2, at.y - h / 2, w, h, h / 2)
  ctx.fill()

  ctx.fillStyle = color
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, at.x, at.y + 0.5)
}

/** Shared by drawHud.ts for the cue chip — a single rounded-rect path helper. */
export function roundRect(ctx: AnyCtx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function drawNodes(
  ctx: AnyCtx,
  frame: OverlayFrame,
  pts: readonly (Point2D | null)[],
  pulse = 1,
): void {
  const quality = effectiveQuality(frame)

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    if (p === null) continue

    const key = NODE_QUALITY_KEY[i]
    const color = qualityColor(key !== undefined ? (quality[key] ?? "base") : "base")
    const major = MAJOR_JOINTS.has(i)
    const rCore = (major ? OVERLAY.node.rBig : OVERLAY.node.rSmall) * (major ? pulse : 1)
    const rHalo = major ? OVERLAY.node.haloBig : OVERLAY.node.haloSmall

    // Halo (cheap glow — the one place shadowBlur is allowed, capped small, §4.4).
    ctx.save()
    ctx.shadowColor = color
    ctx.shadowBlur = OVERLAY.glow.spread
    ctx.fillStyle = hexToRgba(color, OVERLAY.node.haloAlpha)
    ctx.beginPath()
    ctx.arc(p.x, p.y, rHalo, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // Dark inner fill.
    ctx.fillStyle = OVERLAY.color.node
    ctx.beginPath()
    ctx.arc(p.x, p.y, rCore, 0, Math.PI * 2)
    ctx.fill()

    // Bright ring.
    ctx.strokeStyle = color
    ctx.lineWidth = OVERLAY.node.ringWidth
    ctx.beginPath()
    ctx.arc(p.x, p.y, rCore, 0, Math.PI * 2)
    ctx.stroke()

    // Solid inner core.
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(p.x, p.y, rCore * 0.4, 0, Math.PI * 2)
    ctx.fill()
  }
}
