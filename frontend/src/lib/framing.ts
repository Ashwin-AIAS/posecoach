/**
 * Far-subject framing detection (§3E/Phase 5 of
 * docs/enhancements/FIX_POSE_TRACKING_QUALITY.md).
 *
 * A subject standing far back in a mirror occupies only a small slice of the
 * camera frame, so even the 640 model sees few subject pixels and tracks
 * weakly. Keypoints are normalized to the full sent frame, so the bounding box
 * of the confident keypoints is a good proxy for how much of the frame the body
 * fills — small box ⇒ distant subject ⇒ nudge them to move closer.
 */

import type { Keypoint } from "../types"

/** A keypoint is trusted for extent only above this confidence. */
const CONF_GATE = 0.5
/**
 * Require this many confident keypoints before judging distance, so a partial
 * detection (just a face, an arm) never triggers a spurious "move closer".
 */
const MIN_CONFIDENT_KP = 8
/**
 * Below this normalized extent (the larger of the body's width/height span) the
 * subject fills too little of the frame. Conservative on purpose — better to
 * stay silent than nag a reasonably-framed user.
 */
const FAR_SUBJECT_MAX_EXTENT = 0.4

/**
 * Larger of the confident keypoints' normalized width/height span, or `null`
 * when fewer than {@link MIN_CONFIDENT_KP} keypoints clear the confidence gate.
 */
export function bodyExtent(
  keypoints: readonly Keypoint[],
  confidence: readonly number[],
): number | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let count = 0
  for (let i = 0; i < keypoints.length; i++) {
    if ((confidence[i] ?? 0) < CONF_GATE) continue
    const [x, y] = keypoints[i]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    count++
  }
  if (count < MIN_CONFIDENT_KP) return null
  return Math.max(maxX - minX, maxY - minY)
}

/**
 * True when a person is detected but fills too little of the frame to track
 * reliably — drives the "move closer / fill more of the mirror" nudge.
 */
export function isFarSubject(
  keypoints: readonly Keypoint[],
  confidence: readonly number[],
): boolean {
  const extent = bodyExtent(keypoints, confidence)
  return extent !== null && extent < FAR_SUBJECT_MAX_EXTENT
}
