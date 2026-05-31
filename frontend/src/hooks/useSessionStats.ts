import { useCallback, useEffect, useRef } from "react"

import type { PoseResult } from "../types"

export interface SessionStats {
  /** Reps counted this session (latest value from the streaming counter). */
  readonly reps: number
  /** Mean form score across all scored frames this session. */
  readonly avgScore: number
  /** Best single-frame form score this session. */
  readonly bestScore: number
  /** Number of scored frames accumulated. */
  readonly samples: number
}

interface UseSessionStats {
  /** Read the current accumulated stats (called when the user finishes). */
  readonly snapshot: () => SessionStats
  /** Clear all accumulators (call when starting a new set / changing exercise). */
  readonly reset: () => void
}

/**
 * Accumulates live session statistics from the pose stream without triggering
 * re-renders — values live in refs and are snapshotted on demand (e.g. when the
 * user stops the set to view a summary).
 */
export function useSessionStats(result: PoseResult | null): UseSessionStats {
  const sum = useRef(0)
  const count = useRef(0)
  const best = useRef(0)
  const reps = useRef(0)

  useEffect(() => {
    if (result === null) return
    if (typeof result.reps === "number") reps.current = result.reps
    const score = result.score
    if (score !== null && score !== undefined) {
      sum.current += score
      count.current += 1
      if (score > best.current) best.current = score
    }
  }, [result])

  const snapshot = useCallback(
    (): SessionStats => ({
      reps: reps.current,
      avgScore: count.current > 0 ? sum.current / count.current : 0,
      bestScore: best.current,
      samples: count.current,
    }),
    [],
  )

  const reset = useCallback((): void => {
    sum.current = 0
    count.current = 0
    best.current = 0
    reps.current = 0
  }, [])

  return { snapshot, reset }
}
