import { useCallback, useRef } from "react"

import type { ScreenPoint } from "../lib/poseRenderer"
import { KEYPOINT_COUNT } from "../lib/skeleton"

/** EMA smoothing factor for per-joint velocity (deliverable #6). */
export const VELOCITY_ALPHA = 0.4

export interface PoseVelocity {
  /**
   * Feed the latest screen-space keypoints; returns the smoothed per-joint speed
   * in pixels/second. Velocity is `distance(prev, curr) * fps`, EMA-smoothed.
   */
  readonly update: (pts: readonly ScreenPoint[], now: number) => readonly number[]
  /** Latest smoothed velocities (without advancing the estimate). */
  readonly get: () => readonly number[]
  /** Reset history (call on disconnect / exercise change). */
  readonly reset: () => void
}

/**
 * Tracks an EMA-smoothed speed for each of the 17 keypoints, in a ref so the
 * per-frame render loop never triggers a React re-render.
 */
export function usePoseVelocity(): PoseVelocity {
  const prevPtsRef = useRef<readonly ScreenPoint[] | null>(null)
  const prevTimeRef = useRef(0)
  const emaRef = useRef<number[]>(new Array(KEYPOINT_COUNT).fill(0))

  const update = useCallback(
    (pts: readonly ScreenPoint[], now: number): readonly number[] => {
      const prev = prevPtsRef.current
      const dt = (now - prevTimeRef.current) / 1000
      if (prev !== null && dt > 0 && dt < 2) {
        const fps = 1 / dt
        const ema = emaRef.current
        for (let i = 0; i < KEYPOINT_COUNT; i++) {
          const dist = Math.hypot(pts[i].x - prev[i].x, pts[i].y - prev[i].y)
          const v = dist * fps
          ema[i] = VELOCITY_ALPHA * v + (1 - VELOCITY_ALPHA) * ema[i]
        }
      }
      // Snapshot the points so a later mutation of the caller's array can't alias.
      prevPtsRef.current = pts.map((p) => ({ x: p.x, y: p.y }))
      prevTimeRef.current = now
      return emaRef.current
    },
    [],
  )

  const get = useCallback((): readonly number[] => emaRef.current, [])

  const reset = useCallback((): void => {
    prevPtsRef.current = null
    prevTimeRef.current = 0
    emaRef.current = new Array(KEYPOINT_COUNT).fill(0)
  }, [])

  return { update, get, reset }
}
