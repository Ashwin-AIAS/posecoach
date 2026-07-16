/**
 * Visual design tokens for the cyber-neon pose overlay (UI-11 §2). Presentation
 * constants only — no scoring/geometry logic lives here.
 */
export const OVERLAY = {
  color: {
    base: "#35E4FF", // neutral cyan — unevaluated bones/nodes, neck, foot, forearm
    good: "#2BF5B0", // mint neon — on target
    warn: "#FFC24B", // amber — adjust
    error: "#FF4D6D", // rose-red — correct
    dim: "#8FA3C0", // HUD labels
    node: "#0A1120", // node inner fill (dark)
    chipBg: "rgba(7,12,22,0.90)",
  },
  bg: { inner: "#0E1626", mid: "#070C16", outer: "#03060C" }, // radial vignette stops 0/60/100%
  grid: { size: 34, stroke: "rgba(120,150,200,0.06)" },
  bone: { width: 5.5, spineWidth: 6 },
  node: { rSmall: 5.5, rBig: 7, ringWidth: 2.4, haloSmall: 9, haloBig: 13, haloAlpha: 0.16 },
  arc: { rKnee: 30, rHip: 30, rElbow: 24, width: 3, labelOffset: 22 },
  glow: { spread: 4, underlayAlpha: 0.35 }, // see §4.4 cheap-glow
  motion: { scanPeriodMs: 4200, pulsePeriodMs: 2400 },
} as const

export type JointQuality = "good" | "warn" | "error" | "base"

/** Quality -> color is the only semantic mapping (§2); keep to this ramp only. */
export function qualityColor(quality: JointQuality): string {
  switch (quality) {
    case "good":
      return OVERLAY.color.good
    case "warn":
      return OVERLAY.color.warn
    case "error":
      return OVERLAY.color.error
    case "base":
      return OVERLAY.color.base
  }
}

/** Fallback single-band quality from a 0-100 form score (§3.2 graceful degrade). */
export function bandFromScore(score: number): JointQuality {
  if (score >= 85) return "good"
  if (score >= 70) return "warn"
  return "error"
}
