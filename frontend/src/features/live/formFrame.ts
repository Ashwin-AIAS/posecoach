import type { PoseStatus } from "../../types"

export type FormFrameBand = "good" | "mid" | "bad" | "neutral"

const COLOR_GOOD = "#36D399"
const COLOR_MID = "#FFB23D"
const COLOR_BAD = "#FF4D4D"
const COLOR_NEUTRAL = "rgba(255, 255, 255, 0.14)"

/**
 * Maps a live form score (0–100) and frame status to the camera-stage edge
 * semantic band (P36 A3): green >= 80, amber >= 60, red < 60, neutral when
 * no score is available or when the frame status is blocked.
 */
export function formFrameBand(score: number | null, status: PoseStatus = "ok"): FormFrameBand {
  if (status !== "ok" || score === null || Number.isNaN(score)) return "neutral"
  if (score >= 80) return "good"
  if (score >= 60) return "mid"
  return "bad"
}

/** Returns the primary stroke/tint colour for a form-colour frame band. */
export function formFrameColor(score: number | null, status: PoseStatus = "ok"): string {
  const band = formFrameBand(score, status)
  if (band === "good") return COLOR_GOOD
  if (band === "mid") return COLOR_MID
  if (band === "bad") return COLOR_BAD
  return COLOR_NEUTRAL
}

/**
 * Builds the 3–4px inset glow box-shadow string for the camera stage edge.
 * When `repPulse` is true (P36 A4), briefly blends an electric-accent inner
 * flash into the frame without dropping the smooth 300ms transition.
 */
export function formFrameBoxShadow(
  score: number | null,
  status: PoseStatus = "ok",
  repPulse = false,
): string {
  if (repPulse) {
    return "inset 0 0 0 4px rgb(var(--accent) / 0.95), inset 0 0 24px 0 rgb(var(--accent) / 0.45)"
  }
  const band = formFrameBand(score, status)
  if (band === "good") {
    return "inset 0 0 0 3.5px rgba(54, 211, 153, 0.85), inset 0 0 18px 0 rgba(54, 211, 153, 0.28)"
  }
  if (band === "mid") {
    return "inset 0 0 0 3.5px rgba(255, 178, 61, 0.85), inset 0 0 18px 0 rgba(255, 178, 61, 0.28)"
  }
  if (band === "bad") {
    return "inset 0 0 0 3.5px rgba(255, 77, 77, 0.85), inset 0 0 18px 0 rgba(255, 77, 77, 0.28)"
  }
  return "inset 0 0 0 3px rgba(255, 255, 255, 0.12)"
}
