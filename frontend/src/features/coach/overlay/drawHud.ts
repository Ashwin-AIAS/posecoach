/**
 * HUD chrome + motion (§4.3 steps 2 and 6-7): grid/vignette backdrop, corner
 * brackets, top status line, bottom coaching-cue chip, quality legend, and
 * the scan-shimmer band. Pure canvas drawing — reads the frame's already-
 * produced `cue`/`state`, computes nothing about form.
 */
import { roundRect } from "./drawSkeleton"
import { OVERLAY, hexToRgba } from "./overlayTheme"
import type { OverlayTopState } from "./types"

type AnyCtx = CanvasRenderingContext2D

export function drawGridAndVignette(ctx: AnyCtx, w: number, h: number): void {
  ctx.save()
  ctx.strokeStyle = OVERLAY.grid.stroke
  ctx.lineWidth = 1
  const size = OVERLAY.grid.size
  ctx.beginPath()
  for (let x = 0; x <= w; x += size) {
    ctx.moveTo(x + 0.5, 0)
    ctx.lineTo(x + 0.5, h)
  }
  for (let y = 0; y <= h; y += size) {
    ctx.moveTo(0, y + 0.5)
    ctx.lineTo(w, y + 0.5)
  }
  ctx.stroke()
  ctx.restore()

  const cx = w / 2
  const cy = h * 0.4
  const r = Math.max(w, h) * 0.75
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
  gradient.addColorStop(0, hexToRgba(OVERLAY.bg.inner, 0))
  gradient.addColorStop(0.6, hexToRgba(OVERLAY.bg.mid, 0.35))
  gradient.addColorStop(1, hexToRgba(OVERLAY.bg.outer, 0.65))
  ctx.save()
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}

const BRACKET_LEN = 22
const BRACKET_INSET = 14

export function drawCornerBrackets(ctx: AnyCtx, w: number, h: number): void {
  ctx.save()
  ctx.strokeStyle = hexToRgba(OVERLAY.color.dim, 0.55)
  ctx.lineWidth = 1.5
  ctx.lineCap = "round"

  const corners: ReadonlyArray<readonly [number, number, number, number]> = [
    [BRACKET_INSET, BRACKET_INSET, 1, 1],
    [w - BRACKET_INSET, BRACKET_INSET, -1, 1],
    [BRACKET_INSET, h - BRACKET_INSET, 1, -1],
    [w - BRACKET_INSET, h - BRACKET_INSET, -1, -1],
  ]
  for (const [x, y, dx, dy] of corners) {
    ctx.beginPath()
    ctx.moveTo(x + dx * BRACKET_LEN, y)
    ctx.lineTo(x, y)
    ctx.lineTo(x, y + dy * BRACKET_LEN)
    ctx.stroke()
  }
  ctx.restore()
}

const STATE_LABEL: Readonly<Record<OverlayTopState, string>> = {
  good: "GOOD FORM",
  error: "FORM ERROR",
  idle: "SEARCHING…",
}

function stateColor(state: OverlayTopState): string {
  if (state === "good") return OVERLAY.color.good
  if (state === "error") return OVERLAY.color.error
  return OVERLAY.color.base
}

export function drawStatusLine(ctx: AnyCtx, state: OverlayTopState): void {
  const x = 16
  const topY = 20
  const dotY = topY + 16

  ctx.save()
  ctx.textAlign = "left"
  ctx.textBaseline = "middle"

  ctx.font = "600 10px Inter, system-ui, sans-serif"
  ctx.fillStyle = hexToRgba(OVERLAY.color.dim, 0.85)
  ctx.fillText("POSECOACH · LIVE FORM ENGINE", x, topY)

  const color = stateColor(state)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x + 3, dotY, 3, 0, Math.PI * 2)
  ctx.fill()

  ctx.font = "700 11px Inter, system-ui, sans-serif"
  ctx.fillText(STATE_LABEL[state], x + 12, dotY)
  ctx.restore()
}

const LEGEND_ITEMS: ReadonlyArray<readonly [string, string]> = [
  ["ON TARGET", OVERLAY.color.good],
  ["ADJUST", OVERLAY.color.warn],
  ["CORRECT", OVERLAY.color.error],
]

export function drawLegend(ctx: AnyCtx, w: number): void {
  ctx.save()
  ctx.font = "600 9px Inter, system-ui, sans-serif"
  ctx.textAlign = "right"
  ctx.textBaseline = "middle"
  const right = w - 16
  let y = 20
  for (const [label, color] of LEGEND_ITEMS) {
    ctx.fillStyle = hexToRgba(OVERLAY.color.dim, 0.85)
    ctx.fillText(label, right - 10, y)
    const textW = ctx.measureText(label).width
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(right - 10 - textW - 8, y, 3, 0, Math.PI * 2)
    ctx.fill()
    y += 14
  }
  ctx.restore()
}

const CUE_GLYPH_GOOD = "✓" // check
const CUE_GLYPH_ERROR = "✕" // multiplication x, reads as a clean "x" glyph

export function drawCueChip(ctx: AnyCtx, w: number, h: number, cue: string | null, state: OverlayTopState): void {
  if (cue === null || cue.length === 0) return

  const isError = state === "error"
  const glyph = isError ? CUE_GLYPH_ERROR : CUE_GLYPH_GOOD
  const glyphColor = isError ? OVERLAY.color.error : OVERLAY.color.good

  ctx.save()
  ctx.font = "500 13px Inter, system-ui, sans-serif"
  const textW = ctx.measureText(cue).width
  const padX = 14
  const gap = 8
  const glyphW = 14
  const chipW = Math.min(w - 32, textW + glyphW + gap + padX * 2)
  const chipH = 34
  const cx = w / 2
  const cy = h - 28

  ctx.fillStyle = OVERLAY.color.chipBg
  ctx.beginPath()
  roundRect(ctx, cx - chipW / 2, cy - chipH / 2, chipW, chipH, chipH / 2)
  ctx.fill()

  ctx.textAlign = "left"
  ctx.textBaseline = "middle"
  const glyphX = cx - chipW / 2 + padX

  ctx.fillStyle = glyphColor
  ctx.font = "700 13px Inter, system-ui, sans-serif"
  ctx.fillText(glyph, glyphX, cy + 0.5)

  ctx.fillStyle = "#F5F8FF"
  ctx.font = "500 13px Inter, system-ui, sans-serif"
  const maxTextW = chipW - glyphW - gap - padX * 2
  const clipped = ctx.measureText(cue).width > maxTextW ? clipToWidth(ctx, cue, maxTextW) : cue
  ctx.fillText(clipped, glyphX + glyphW + gap, cy + 0.5)
  ctx.restore()
}

function clipToWidth(ctx: AnyCtx, text: string, maxWidth: number): string {
  let out = text
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1)
  }
  return `${out}…`
}

/** Slow vertical scan-shimmer (§4.3 step 7). `progress` cycles [0, 1). Skipped entirely under prefers-reduced-motion. */
export function drawScanBand(ctx: AnyCtx, w: number, h: number, progress: number): void {
  const bandH = h * 0.22
  const centerY = -bandH + progress * (h + bandH * 2)
  const gradient = ctx.createLinearGradient(0, centerY - bandH / 2, 0, centerY + bandH / 2)
  gradient.addColorStop(0, hexToRgba(OVERLAY.color.base, 0))
  gradient.addColorStop(0.5, hexToRgba(OVERLAY.color.base, 0.06))
  gradient.addColorStop(1, hexToRgba(OVERLAY.color.base, 0))
  ctx.save()
  ctx.fillStyle = gradient
  ctx.fillRect(0, centerY - bandH / 2, w, bandH)
  ctx.restore()
}
