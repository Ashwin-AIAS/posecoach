/**
 * Pure presentation geometry for the neon overlay: cover-fit projection,
 * mirroring, joint angles, and arc sweeps. Display-only math — never feeds
 * back into scoring (UI-11 §3.2/§4.2). No React, no canvas calls, no DOM.
 */

export interface Point2D {
  readonly x: number
  readonly y: number
}

export interface CoverProjection {
  readonly drawW: number
  readonly drawH: number
  readonly offX: number
  readonly offY: number
}

/**
 * Cover-fit projection of a video's native size into a canvas box, matching
 * the `object-fit: cover` transform the live `<video>` is displayed with.
 * Same convention as the frozen `lib/poseRenderer.ts` (reimplemented here,
 * standalone, so this file has zero dependency on frozen code).
 */
export function computeCoverProjection(
  canvasW: number,
  canvasH: number,
  videoW: number,
  videoH: number,
): CoverProjection {
  if (canvasW <= 0 || canvasH <= 0 || videoW <= 0 || videoH <= 0) {
    return { drawW: canvasW, drawH: canvasH, offX: 0, offY: 0 }
  }
  const scale = Math.max(canvasW / videoW, canvasH / videoH)
  const drawW = videoW * scale
  const drawH = videoH * scale
  return { drawW, drawH, offX: (drawW - canvasW) / 2, offY: (drawH - canvasH) / 2 }
}

/** Normalized [0,1] keypoint -> canvas CSS px, honoring mirror + cover-fit (§4.2). */
export function toCanvasXY(
  nx: number,
  ny: number,
  mirrored: boolean,
  proj: CoverProjection,
): Point2D {
  const x = mirrored ? 1 - nx : nx
  return {
    x: x * proj.drawW - proj.offX,
    y: ny * proj.drawH - proj.offY,
  }
}

/**
 * Interior angle at vertex `b` formed by rays b->a and b->c, in degrees
 * [0, 180]. Orientation-independent — swapping `a` and `c` gives the same
 * result. Returns 0 for a degenerate (zero-length) ray rather than NaN.
 */
export function angle(a: Point2D, b: Point2D, c: Point2D): number {
  const abx = a.x - b.x
  const aby = a.y - b.y
  const cbx = c.x - b.x
  const cby = c.y - b.y
  const magAB = Math.hypot(abx, aby)
  const magCB = Math.hypot(cbx, cby)
  if (magAB === 0 || magCB === 0) return 0
  const dot = abx * cbx + aby * cby
  const cos = Math.min(1, Math.max(-1, dot / (magAB * magCB)))
  return (Math.acos(cos) * 180) / Math.PI
}

export interface ArcSweep {
  /** Canvas-space start angle (atan2 convention) for `ctx.arc()`. */
  readonly startAngle: number
  /** Canvas-space end angle for `ctx.arc()`. */
  readonly endAngle: number
  /** `ctx.arc()`'s `anticlockwise` flag, chosen so the SHORTER sweep is drawn. */
  readonly anticlockwise: boolean
}

/**
 * Sweep parameters to draw the interior angle at vertex `b` (rays b->a,
 * b->c) as a single `ctx.arc(bx, by, r, startAngle, endAngle, anticlockwise)`
 * call, always taking the shorter (non-reflex) arc between the two rays.
 */
export function arcSweep(a: Point2D, b: Point2D, c: Point2D): ArcSweep {
  const startAngle = Math.atan2(a.y - b.y, a.x - b.x)
  const endAngle = Math.atan2(c.y - b.y, c.x - b.x)
  const twoPi = 2 * Math.PI
  const ccwSweep = (((endAngle - startAngle) % twoPi) + twoPi) % twoPi
  return { startAngle, endAngle, anticlockwise: ccwSweep > Math.PI }
}

/**
 * Point on the arc's bisector at `radius` from vertex `b` — where the degree
 * pill label anchors.
 */
export function arcLabelPoint(a: Point2D, b: Point2D, c: Point2D, radius: number): Point2D {
  const sweep = arcSweep(a, b, c)
  const twoPi = 2 * Math.PI
  const mid = sweep.anticlockwise
    ? sweep.startAngle - (((sweep.startAngle - sweep.endAngle) % twoPi) + twoPi) % twoPi / 2
    : sweep.startAngle + (((sweep.endAngle - sweep.startAngle) % twoPi) + twoPi) % twoPi / 2
  return { x: b.x + radius * Math.cos(mid), y: b.y + radius * Math.sin(mid) }
}
