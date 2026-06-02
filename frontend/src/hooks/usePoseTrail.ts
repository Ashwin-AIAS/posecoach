import { useCallback, useRef } from "react"

import type { Keypoint } from "../types"

/** One stored pose frame for the stroboscopic motion trail. */
export interface TrailFrame {
  /** Normalized (0–1) keypoint coords, copied so later mutation can't corrupt it. */
  readonly pts: readonly Keypoint[]
  readonly conf: readonly number[]
}

/** Number of past frames kept in the trail ring buffer (deliverable #4). */
export const TRAIL_LENGTH = 8

export interface PoseTrail {
  /** Append the latest frame, evicting the oldest beyond TRAIL_LENGTH. */
  readonly push: (frame: TrailFrame) => void
  /** Clear the buffer (called on a rep's up→down transition). */
  readonly reset: () => void
  /** Current frames, oldest first. */
  readonly get: () => readonly TrailFrame[]
}

/**
 * Fixed-size ring buffer of the last {@link TRAIL_LENGTH} pose frames, held in a
 * ref so pushing a frame never re-renders React. The caller wipes the trail on a
 * rep transition so stroboscopic streaks don't pile up across reps.
 */
export function usePoseTrail(): PoseTrail {
  const framesRef = useRef<TrailFrame[]>([])

  const push = useCallback((frame: TrailFrame): void => {
    const frames = framesRef.current
    frames.push(frame)
    if (frames.length > TRAIL_LENGTH) frames.shift()
  }, [])

  const reset = useCallback((): void => {
    framesRef.current = []
  }, [])

  const get = useCallback((): readonly TrailFrame[] => framesRef.current, [])

  return { push, reset, get }
}
