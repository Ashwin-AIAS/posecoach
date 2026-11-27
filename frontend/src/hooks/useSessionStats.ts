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
  /** Lowest-scoring joint key across the set when mean joint score < 80, or null. */
  readonly worstJoint?: string | null
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
  const jointTotals = useRef<Record<string, { sum: number; count: number }>>({})
  const worstCounts = useRef<Record<string, number>>({})

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

    if (result.joint_scores !== undefined) {
      for (const [key, val] of Object.entries(result.joint_scores)) {
        const entry = jointTotals.current[key] ?? { sum: 0, count: 0 }
        entry.sum += val
        entry.count += 1
        jointTotals.current[key] = entry
      }
    } else if (result.worst_joint) {
      worstCounts.current[result.worst_joint] = (worstCounts.current[result.worst_joint] ?? 0) + 1
    }
  }, [result])

  const computeWorstJoint = (): string | null => {
    let worstKey: string | null = null
    let worstMean = 80
    for (const [key, { sum: s, count: c }] of Object.entries(jointTotals.current)) {
      if (c <= 0) continue
      const mean = s / c
      if (mean < worstMean) {
        worstMean = mean
        worstKey = key
      }
    }
    if (worstKey !== null) return worstKey
    let topCount = 0
    for (const [key, c] of Object.entries(worstCounts.current)) {
      if (c > topCount) {
        topCount = c
        worstKey = key
      }
    }
    return worstKey
  }

  const snapshot = useCallback(
    (): SessionStats => ({
      reps: reps.current,
      avgScore: count.current > 0 ? sum.current / count.current : 0,
      bestScore: best.current,
      samples: count.current,
      repScores: [...repScores.current],
      holdSeries: [...holdSeries.current],
      worstJoint: computeWorstJoint(),
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
    jointTotals.current = {}
    worstCounts.current = {}
  }, [])

  return { snapshot, reset }
}
