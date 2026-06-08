import type { Keypoint } from "../types"

// EMA factor for the measured server-frame interval. Low → a stable estimate
// that a single jittery gap can't yank around.
const INTERVAL_ALPHA = 0.2
// Clamp the measured interval so a one-off long gap (tab stall, GC pause) or a
// burst of unusually fast frames can't distort the render timeline.
const MIN_INTERVAL_MS = 40
const MAX_INTERVAL_MS = 200
// How far *behind* real time we render, in fractions of one server interval.
// 0.5 keeps us mid-way between the two latest frames so motion is reconstructed
// by interpolation (stutter-free) for most of the gap, while extrapolation only
// covers the tail. At a steady frame rate the forward extrapolation of one frame
// exactly meets the interpolation of the next, so the skeleton glides without a
// seam. The cost is ~half a server interval (~40–90ms) of added display lag —
// far less than the pipeline latency it smooths over, and a net win for the
// "tracks my movement" feel because the eye follows smooth motion.
const RENDER_DELAY_FRAC = 0.5
// Cap on forward extrapolation past the newest frame (fractions of an interval)
// when the next frame is late. Beyond this the pose holds rather than flying off
// on a stale velocity — important at a rep turnaround where the true motion
// reverses. Combined with the delay above, the render parameter spans [0, 1.5].
const MAX_EXTRAP = 0.5
// Don't blend a joint whose sample is unreliable in either frame — its stored
// coordinate may be a gated-out (~0,0) placeholder. Hold the latest instead so
// we never interpolate through a garbage point.
const CONF_GATE = 0.5

export interface PoseSample {
  readonly keypoints: readonly Keypoint[]
  readonly confidence: readonly number[]
}

export interface PoseInterpolator {
  /** Record a freshly-arrived server frame and its arrival time (perf-clock ms). */
  readonly push: (
    keypoints: readonly Keypoint[],
    confidence: readonly number[],
    now: number,
  ) => void
  /**
   * Render-time pose for `now`. Interpolates between the two most recent server
   * frames (rendering {@link RENDER_DELAY_FRAC} of an interval behind so the gap
   * is reconstructed smoothly) and extrapolates a capped amount past the newest
   * frame to bridge a late one. Returns null until a frame has been pushed.
   */
  readonly sample: (now: number) => PoseSample | null
  /** Drop all history — call on disconnect / no-person / exercise change. */
  readonly reset: () => void
}

interface Frame {
  readonly kp: readonly Keypoint[]
  readonly conf: readonly number[]
  readonly t: number
}

/**
 * Render-time pose interpolator. The inference WebSocket delivers keypoints at
 * the server's frame rate (~6–15 Hz on a CPU backend), but the overlay redraws
 * at the rAF rate (~30–60 Hz). Drawing the raw server frames makes the skeleton
 * snap between discrete positions; feeding them through this interpolator and
 * sampling per render tick makes it glide along the body's actual path.
 *
 * Pure and framework-free so the timing math is unit-testable in isolation.
 */
export function createPoseInterpolator(): PoseInterpolator {
  let prev: Frame | null = null
  let cur: Frame | null = null
  // Null until two frames have been seen; then the EMA of the inter-frame gap.
  let interval: number | null = null

  const push = (
    keypoints: readonly Keypoint[],
    confidence: readonly number[],
    now: number,
  ): void => {
    const frame: Frame = {
      kp: keypoints.map(([x, y]) => [x, y] as Keypoint),
      conf: confidence.slice(),
      t: now,
    }
    if (cur !== null) {
      const dt = now - cur.t
      if (dt > 0) {
        const clamped = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, dt))
        // First measured gap seeds the estimate exactly; later gaps blend in.
        interval = interval === null ? clamped : INTERVAL_ALPHA * clamped + (1 - INTERVAL_ALPHA) * interval
      }
      prev = cur
    }
    cur = frame
  }

  const sample = (now: number): PoseSample | null => {
    if (cur === null) return null
    // Only one frame (or no measurable interval yet): nothing to interpolate.
    if (prev === null || interval === null) {
      return { keypoints: cur.kp.map(([x, y]) => [x, y] as Keypoint), confidence: cur.conf.slice() }
    }

    // s: position on the prev→cur line. prev sits at 0, cur at 1; the render
    // delay shifts us back, and values >1 extrapolate past cur (capped).
    const s = Math.min(
      1 + MAX_EXTRAP,
      Math.max(0, (now - prev.t) / interval - RENDER_DELAY_FRAC),
    )

    const n = cur.kp.length
    const out: Keypoint[] = new Array(n)
    for (let i = 0; i < n; i++) {
      const [cx, cy] = cur.kp[i]
      const p = prev.kp[i]
      if (p === undefined || prev.conf[i] < CONF_GATE || cur.conf[i] < CONF_GATE) {
        out[i] = [cx, cy]
        continue
      }
      const [px, py] = p
      out[i] = [px + (cx - px) * s, py + (cy - py) * s]
    }
    return { keypoints: out, confidence: cur.conf.slice() }
  }

  const reset = (): void => {
    prev = null
    cur = null
    interval = null
  }

  return { push, sample, reset }
}
