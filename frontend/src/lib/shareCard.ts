/**
 * On-device shareable 1080x1920 PNG result card (P36 Lane B — B3).
 *
 * Renders exercise, reps, avg form, best rep, per-rep score bars, date, and a
 * text-only "PoseCoach" wordmark onto an offscreen `<canvas>`. Runs strictly
 * on-device: zero network requests, zero camera frames.
 */

import { downloadFile } from "../hooks/useSessionRecorder"
import { ACCENT_COLOR, scoreColor } from "./skeleton"

export const SHARE_CARD_WIDTH = 1080
export const SHARE_CARD_HEIGHT = 1920

const BG_BASE = "#0A0B0D"
const BG_RAISED = "#15171C"
const BG_TILE = "#1B1E24"
const TEXT_WHITE = "#F4F6F8"
const TEXT_MUTED = "#9CA3AF"
const TEXT_DIM = "#6B7280"

export interface ShareCardInput {
  readonly exerciseId: string
  readonly exerciseLabel: string
  readonly reps: number
  readonly avgScore: number
  readonly bestScore: number
  readonly samples: number
  readonly repScores: readonly number[]
  readonly verdict?: string
  readonly date?: Date
}

interface FileShareData {
  readonly files: readonly File[]
  readonly title?: string
}

type ShareCapableNavigator = Navigator & {
  canShare?: (data: FileShareData) => boolean
  share?: (data: FileShareData) => Promise<void>
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

function formatCardDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

/** Paints the 1080x1920 result card onto a newly created offscreen canvas. */
export function renderShareCardCanvas(input: ShareCardInput): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = SHARE_CARD_WIDTH
  canvas.height = SHARE_CARD_HEIGHT

  const ctx = canvas.getContext("2d")
  if (ctx === null) {
    throw new Error("2D canvas context unavailable")
  }

  const W = SHARE_CARD_WIDTH
  const H = SHARE_CARD_HEIGHT
  const padX = 76
  const innerW = W - padX * 2
  const dateStr = formatCardDate(input.date ?? new Date()).toUpperCase()

  // 1. Background gradient + subtle top accent glow
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H)
  bgGrad.addColorStop(0, BG_RAISED)
  bgGrad.addColorStop(0.45, BG_BASE)
  bgGrad.addColorStop(1, BG_BASE)
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, W, H)

  const glow = ctx.createRadialGradient(W / 2, 260, 20, W / 2, 260, 620)
  glow.addColorStop(0, "rgba(139, 92, 255, 0.22)")
  glow.addColorStop(1, "rgba(139, 92, 255, 0)")
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, 900)

  // 2. Top bar: text-only "PoseCoach" wordmark + date
  ctx.textBaseline = "alphabetic"
  ctx.textAlign = "left"
  ctx.font = '600 52px "Space Grotesk Variable", Inter, system-ui, sans-serif'
  ctx.fillStyle = TEXT_WHITE
  ctx.fillText("Pose", padX, 148)
  const poseWidth = ctx.measureText("Pose").width
  ctx.fillStyle = ACCENT_COLOR
  ctx.fillText("Coach", padX + poseWidth, 148)

  ctx.textAlign = "right"
  ctx.font = "600 26px Inter, system-ui, sans-serif"
  ctx.fillStyle = TEXT_MUTED
  ctx.fillText(dateStr, W - padX, 142)

  // 3. Exercise title block
  ctx.textAlign = "left"
  ctx.font = "600 24px Inter, system-ui, sans-serif"
  ctx.fillStyle = TEXT_DIM
  ctx.fillText("SET SUMMARY", padX, 262)

  ctx.font = '700 76px "Space Grotesk Variable", Inter, system-ui, sans-serif'
  ctx.fillStyle = TEXT_WHITE
  ctx.fillText(input.exerciseLabel, padX, 352)

  // 4. Hero rep count card (counts always white/accent, never score ramp)
  const heroY = 416
  const heroH = 440
  drawRoundedRect(ctx, padX, heroY, innerW, heroH, 44)
  ctx.fillStyle = BG_TILE
  ctx.fill()

  ctx.textAlign = "center"
  ctx.font = '700 210px "Space Grotesk Variable", Inter, system-ui, sans-serif'
  ctx.fillStyle = TEXT_WHITE
  ctx.fillText(String(input.reps), W / 2, heroY + 235)

  ctx.font = "600 28px Inter, system-ui, sans-serif"
  ctx.fillStyle = TEXT_DIM
  ctx.fillText("REPS", W / 2, heroY + 292)

  if (input.verdict) {
    ctx.font = "500 34px Inter, system-ui, sans-serif"
    ctx.fillStyle = TEXT_MUTED
    ctx.fillText(input.verdict, W / 2, heroY + 372)
  }

  // 5. Avg form & Best rep tiles (form quality uses score ramp)
  const statsY = heroY + heroH + 36
  const statsH = 250
  const tileGap = 32
  const tileW = (innerW - tileGap) / 2

  drawRoundedRect(ctx, padX, statsY, tileW, statsH, 36)
  ctx.fillStyle = BG_TILE
  ctx.fill()

  const avgText = input.samples > 0 ? String(Math.round(input.avgScore)) : "—"
  ctx.font = '700 104px "Space Grotesk Variable", Inter, system-ui, sans-serif'
  ctx.fillStyle = input.samples > 0 ? scoreColor(input.avgScore) : TEXT_MUTED
  ctx.fillText(avgText, padX + tileW / 2, statsY + 142)

  ctx.font = "600 24px Inter, system-ui, sans-serif"
  ctx.fillStyle = TEXT_DIM
  ctx.fillText("AVG FORM", padX + tileW / 2, statsY + 202)

  const rightX = padX + tileW + tileGap
  drawRoundedRect(ctx, rightX, statsY, tileW, statsH, 36)
  ctx.fillStyle = BG_TILE
  ctx.fill()

  const bestText = input.bestScore > 0 ? String(Math.round(input.bestScore)) : "—"
  ctx.font = '700 104px "Space Grotesk Variable", Inter, system-ui, sans-serif'
  ctx.fillStyle = input.bestScore > 0 ? scoreColor(input.bestScore) : TEXT_MUTED
  ctx.fillText(bestText, rightX + tileW / 2, statsY + 142)

  ctx.font = "600 24px Inter, system-ui, sans-serif"
  ctx.fillStyle = TEXT_DIM
  ctx.fillText("BEST REP", rightX + tileW / 2, statsY + 202)

  // 6. Per-rep form bars card
  const barsY = statsY + statsH + 36
  const barsCardH = 490
  drawRoundedRect(ctx, padX, barsY, innerW, barsCardH, 44)
  ctx.fillStyle = BG_TILE
  ctx.fill()

  ctx.textAlign = "left"
  ctx.font = "600 24px Inter, system-ui, sans-serif"
  ctx.fillStyle = TEXT_DIM
  ctx.fillText("PER-REP FORM", padX + 48, barsY + 68)

  const chartX = padX + 48
  const chartY = barsY + 112
  const chartW = innerW - 96
  const chartH = 310

  if (input.repScores.length > 0) {
    const n = input.repScores.length
    const gap = Math.min(18, Math.max(6, Math.floor(chartW / (n * 5))))
    const slot = chartW / n
    const barW = Math.max(10, slot - gap)

    for (let i = 0; i < n; i++) {
      const score = input.repScores[i]
      const clamped = Math.max(0, Math.min(100, score))
      const bh = Math.max(12, (clamped / 100) * chartH)
      const bx = chartX + i * slot + (slot - barW) / 2
      const by = chartY + (chartH - bh)

      drawRoundedRect(ctx, bx, by, barW, bh, Math.min(14, barW / 2))
      ctx.fillStyle = scoreColor(score)
      ctx.fill()
    }
  } else {
    ctx.textAlign = "center"
    ctx.font = "500 30px Inter, system-ui, sans-serif"
    ctx.fillStyle = TEXT_DIM
    ctx.fillText("No per-rep bars recorded for this set", W / 2, chartY + chartH / 2)
  }

  // 7. Footer tagline
  ctx.textAlign = "center"
  ctx.font = "600 24px Inter, system-ui, sans-serif"
  ctx.fillStyle = TEXT_DIM
  ctx.fillText("REAL-TIME AI FORM COACHING", W / 2, H - 96)

  return canvas
}

/** Exports the rendered 1080x1920 card as an `image/png` Blob. */
export function renderShareCardBlob(input: ShareCardInput): Promise<Blob> {
  const canvas = renderShareCardCanvas(input)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob !== null) {
        resolve(blob)
      } else {
        reject(new Error("Failed to encode share card PNG"))
      }
    }, "image/png")
  })
}

/**
 * Generates the PNG card on-device and opens the OS share sheet when supported,
 * falling back to downloading the PNG file locally.
 */
export async function shareResultCard(
  input: ShareCardInput,
): Promise<"shared" | "downloaded" | "cancelled"> {
  const blob = await renderShareCardBlob(input)
  const day = (input.date ?? new Date()).toISOString().slice(0, 10)
  const file = new File([blob], `posecoach-${input.exerciseId}-${day}.png`, {
    type: "image/png",
  })

  const nav = navigator as ShareCapableNavigator
  if (typeof nav.canShare === "function" && typeof nav.share === "function") {
    let supported = false
    try {
      supported = nav.canShare({ files: [file] })
    } catch {
      supported = false
    }
    if (supported) {
      try {
        await nav.share({ files: [file], title: `${input.exerciseLabel} · PoseCoach` })
        return "shared"
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          return "cancelled"
        }
        // Other share errors fall through to download
      }
    }
  }

  downloadFile(file)
  return "downloaded"
}
