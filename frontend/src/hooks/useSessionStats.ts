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
  /** Form score captured at each rep boundary — one entry per counted rep. */
  readonly repScores: readonly number[]
  /** Form score samples gathered during an isometric hold (plank); empty otherwise. */
  readonly holdSeries: readonly number[]
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
  const lastReps = useRef(0)
  const repScores = useRef<number[]>([])
  const holdSeries = useRef<number[]>([])

  useEffect(() => {
    if (result === null) return
    const score = result.score
    const hasScore = score !== null && score !== undefined

    if (typeof result.reps === "number") {
      // On a rep boundary, capture the current form score — one entry per rep.
      // TODO(v2): track a representative (e.g. min) score within each rep window;
      // the instantaneous score at the boundary can be noisy.
      if (result.reps > lastReps.current && hasScore) {
        repScores.current.push(score)
      }
      lastReps.current = result.reps
      reps.current = result.reps
    }

    if (hasScore) {
      sum.current += score
      count.current += 1
      if (score > best.current) best.current = score
      // Isometric holds (plank) don't increment reps — capture a hold timeline.
      if (result.hold_s !== undefined) holdSeries.current.push(score)
    }
  }, [result])

  const snapshot = useCallback(
    (): SessionStats => ({
      reps: reps.current,
      avgScore: count.current > 0 ? sum.current / count.current : 0,
      bestScore: best.current,
      samples: count.current,
      repScores: [...repScores.current],
      holdSeries: [...holdSeries.current],
    }),
    [],
  )

  const reset = useCallback((): void => {
    sum.current = 0
    count.current = 0
    best.current = 0
    reps.current = 0
    lastReps.current = 0
    repScores.current = []
    holdSeries.current = []
  }, [])

  return { snapshot, reset }
}
