/**
 * Native HUD re-draw for the recording compositor (spec §3.4).
 *
 * The live HUD (`CameraHud.tsx`) is HTML/CSS with `backdrop-blur`, which cannot
 * be rasterized per-frame (see spec §2). Instead we re-draw the same chips
 * natively onto the compositor canvas and *approximate* the frosted glass:
 * blur-sample the underlying region, lay a translucent fill + hairline, then the
 * text. This is a faithful re-creation of `CameraHud`'s layout, not a pixel copy.
 *
 * Layout, copy, and gating mirror `CameraHud.tsx` exactly (score ring, rep/hold
 * counter, worst-joint chip, cue caption, and the center status banner that
 * replaces the cue + worst chip when a frame can't be scored — P13).
 */

import type { Exercise, PoseResult, PoseStatus } from "../types"
import type { WorstJoint } from "./joints"
import { scoreColor } from "./skeleton"

/** Glass-chip approximation tokens (kept close to the Tailwind surface colors). */
const GLASS_FILL = "rgba(10, 11, 13, 0.55)"
const HAIRLINE = "rgba(35, 38, 45, 0.85)"
const TRACK = "#23262D"
const WHITE = "#F3F4F6"
const MUTED = "#9CA3AF"
const ACCENT = "#8B5CFF"
const BAD = "#FF4D4D"
const BAD_TINT = "rgba(255, 77, 77, 0.15)"

/** Fallback banner copy when a frame can't be scored and carries no cue. */
const STATUS_FALLBACK: Record<Exclude<PoseStatus, "ok">, string> = {
  no_person: "Step into frame",
  insufficient_confidence: "Hold still — adjusting to you",
  mismatch: "Doesn't match the exercise",
  wrong_orientation: "Turn to the right orientation",
  unknown_pose: "Pick a pose to score",
}

const FONT = "Inter, system-ui, sans-serif"

/** Everything the HUD renderer needs for one frame. */
export interface HudScene {
  readonly result: PoseResult | null
  readonly exercise: Exercise
  readonly worst: WorstJoint | null
  /** recording px ÷ on-screen px, so chip sizes match what the user saw (§3.4). */
  readonly scale: number
}

function textWidth(ctx: CanvasRenderingContext2D, text: string): number {
  const metrics = ctx.measureText(text)
  return typeof metrics?.width === "number" ? metrics.width : text.length * 8
}

/** Trailing-ellipsis truncation so a long cue never overflows the pill. */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (textWidth(ctx, text) <= maxW) return text
  let t = text
  while (t.length > 1 && textWidth(ctx, `${t}…`) > maxW) t = t.slice(0, -1)
  return `${t}…`
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/**
 * Frosted-glass chip: blur the pixels already drawn underneath (video + overlay),
 * lay a translucent fill, then a hairline border — clipped to a rounded rect.
 * Defensive: if a 2D backdrop sample is unavailable (e.g. jsdom), just fill.
 */
function glassChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const src = ctx.canvas as HTMLCanvasElement | undefined
  ctx.save()
  roundRectPath(ctx, x, y, w, h, r)
  ctx.clip()
  if (src) {
    const tmp = document.createElement("canvas")
    tmp.width = Math.max(1, Math.ceil(w))
    tmp.height = Math.max(1, Math.ceil(h))
    const tctx = tmp.getContext("2d")
    if (tctx) {
      tctx.drawImage(src, x, y, w, h, 0, 0, tmp.width, tmp.height)
      ctx.filter = "blur(8px)"
      ctx.drawImage(tmp, x, y, w, h)
      ctx.filter = "none"
    }
  }
  ctx.fillStyle = GLASS_FILL
  ctx.fillRect(x, y, w, h)
  ctx.restore()
  roundRectPath(ctx, x, y, w, h, r)
  ctx.lineWidth = 1
  ctx.strokeStyle = HAIRLINE
  ctx.stroke()
}

interface PillOptions {
  readonly font: string
  readonly color: string
  readonly padX: number
  readonly h: number
  readonly radius: number
  /** Optional translucent tint over the glass (worst-joint chip is red). */
  readonly tint: string | null
}

/** Centered text pill (worst-joint chip, cue caption, status banner). */
function drawPill(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  text: string,
  opts: PillOptions,
): void {
  ctx.font = opts.font
  const w = textWidth(ctx, text) + opts.padX * 2
  const x = cx - w / 2
  const y = cy - opts.h / 2
  glassChip(ctx, x, y, w, opts.h, opts.radius)
  if (opts.tint !== null) {
    roundRectPath(ctx, x, y, w, opts.h, opts.radius)
    ctx.fillStyle = opts.tint
    ctx.fill()
  }
  ctx.fillStyle = opts.color
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, cx, cy)
}

/** Top-right circular form-score gauge (port of `ScoreRing` arc math). */
function drawScoreRing(ctx: CanvasRenderingContext2D, w: number, scene: HudScene, s: number): void {
  const pad = 12 * s
  const size = 104 * s
  const stroke = 8 * s
  const chip = size + 12 * s
  glassChip(ctx, w - pad - chip + 6 * s, pad - 6 * s, chip, chip, 16 * s)

  const cx = w - pad - size / 2
  const cy = pad + size / 2
  const r = (size - stroke) / 2
  const score = scene.result?.score ?? null

  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.lineWidth = stroke
  ctx.strokeStyle = TRACK
  ctx.stroke()

  const pct = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100
  const color = scoreColor(score)
  if (pct > 0) {
    ctx.beginPath()
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2)
    ctx.lineWidth = stroke
    ctx.lineCap = "round"
    ctx.strokeStyle = color
    ctx.stroke()
  }

  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillStyle = color
  ctx.font = `600 ${Math.round(size * 0.3)}px ${FONT}`
  ctx.fillText(score === null ? "—" : String(Math.round(score)), cx, cy)
  ctx.fillStyle = MUTED
  ctx.font = `500 ${Math.round(10 * s)}px ${FONT}`
  ctx.fillText("FORM", cx, cy + size * 0.24)
}

/** Top-left rep counter, or the hold timer for plank. */
function drawCounter(ctx: CanvasRenderingContext2D, scene: HudScene, s: number): void {
  const pad = 12 * s
  const isPlank = scene.exercise === "plank"
  const big = isPlank ? `${(scene.result?.hold_s ?? 0).toFixed(1)}s` : String(scene.result?.reps ?? 0)
  const label = isPlank ? "hold" : "reps"
  const chipH = 46 * s

  ctx.font = `600 ${Math.round(30 * s)}px ${FONT}`
  const bw = textWidth(ctx, big)
  ctx.font = `500 ${Math.round(11 * s)}px ${FONT}`
  const lw = textWidth(ctx, label)
  const chipW = bw + lw + 30 * s

  glassChip(ctx, pad, pad, chipW, chipH, 14 * s)
  ctx.textAlign = "left"
  ctx.textBaseline = "middle"
  ctx.fillStyle = isPlank ? ACCENT : WHITE
  ctx.font = `600 ${Math.round(30 * s)}px ${FONT}`
  ctx.fillText(big, pad + 12 * s, pad + chipH / 2)
  ctx.fillStyle = MUTED
  ctx.font = `500 ${Math.round(11 * s)}px ${FONT}`
  ctx.fillText(label, pad + 12 * s + bw + 6 * s, pad + chipH / 2 + 4 * s)
}

/**
 * Draws the full HUD for one recording frame onto `ctx`. `w`/`h` are the
 * compositor (recording) pixel size; `scene.scale` maps on-screen px → recording
 * px so chips land where the user saw them.
 */
export function renderHud(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scene: HudScene,
): void {
  const s = scene.scale > 0 ? scene.scale : 1
  const status: PoseStatus = scene.result?.status ?? "ok"
  const blocked = status !== "ok"
  const topCue = scene.result?.cues?.[0]

  // Always-on chrome: score ring + counter (shown even on a blocked frame, like CameraHud).
  drawScoreRing(ctx, w, scene, s)
  drawCounter(ctx, scene, s)

  // Blocked frame: a center status banner replaces the cue + worst chip, so a
  // "can't see you" frame never reads as a form correction (P13).
  if (blocked) {
    const message = topCue ?? STATUS_FALLBACK[status]
    drawPill(ctx, w / 2, h / 2, ellipsize(ctx, message, w * 0.7), {
      font: `500 ${Math.round(16 * s)}px ${FONT}`,
      color: ACCENT,
      padX: 20 * s,
      h: 48 * s,
      radius: 16 * s,
      tint: null,
    })
    return
  }

  // Worst-joint callout (top-center) — only on a normally-scored frame.
  if (scene.worst !== null) {
    drawPill(ctx, w / 2, 12 * s + 15 * s, `Fix: ${scene.worst.bodyPart}`, {
      font: `500 ${Math.round(14 * s)}px ${FONT}`,
      color: BAD,
      padX: 14 * s,
      h: 30 * s,
      radius: 15 * s,
      tint: BAD_TINT,
    })
  }

  // Lower-third coaching caption.
  if (topCue !== undefined && topCue.length > 0) {
    drawPill(ctx, w / 2, h - 28 * s, ellipsize(ctx, topCue, w * 0.8), {
      font: `500 ${Math.round(16 * s)}px ${FONT}`,
      color: WHITE,
      padX: 20 * s,
      h: 44 * s,
      radius: 22 * s,
      tint: null,
    })
  }
}
