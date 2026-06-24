/**
 * Capture-time low-light assist (§3E/Phase 5 of
 * docs/enhancements/FIX_POSE_TRACKING_QUALITY.md).
 *
 * A dim room yields noisy, low-confidence keypoints that fall under the
 * confidence gates, collapsing the skeleton. A mild brightness/contrast lift
 * applied ONLY to genuinely dark frames recovers some of that signal without
 * washing out normally-lit frames — in normal light the lift never activates.
 */

/** Mean perceptual luma (0–255, Rec. 601) of a tightly-packed RGBA buffer. */
export function meanLuma(data: Uint8ClampedArray): number {
  let sum = 0
  let n = 0
  for (let i = 0; i + 3 < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    n++
  }
  return n > 0 ? sum / n : 0
}

/** Below this mean luma a capture frame is treated as "dark". */
export const DARK_LUMA_THRESHOLD = 70
/**
 * Conservative lift for dark frames — enough to help the model, mild enough not
 * to wash out (a dim frame at ~50 luma rises to ~58, still well within range).
 */
export const LOW_LIGHT_FILTER = "brightness(1.15) contrast(1.08)"
/** Square side (px) of the cheap off-screen luma probe. */
export const LUMA_PROBE_SIZE = 32
