import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { useSessionStats } from "../hooks/useSessionStats"
import type { PoseResult } from "../types"

function frame(partial: Partial<PoseResult>): PoseResult {
  return {
    keypoints: [],
    confidence: [],
    score: null,
    cues: [],
    latency_ms: 40,
    ...partial,
  }
}

describe("useSessionStats per-rep timeline", () => {
  it("captures one score per rep as reps climb 0→1→2→3", () => {
    const { result, rerender } = renderHook((r: PoseResult | null) => useSessionStats(r), {
      initialProps: frame({ reps: 0, score: 50 }) as PoseResult | null,
    })

    rerender(frame({ reps: 1, score: 60 }))
    rerender(frame({ reps: 2, score: 72 }))
    rerender(frame({ reps: 3, score: 81 }))

    const snap = result.current.snapshot()
    expect(snap.reps).toBe(3)
    expect(snap.repScores).toEqual([60, 72, 81])
    expect(snap.holdSeries).toEqual([])
  })

  it("does not double-count when reps stays the same across frames", () => {
    const { result, rerender } = renderHook((r: PoseResult | null) => useSessionStats(r), {
      initialProps: frame({ reps: 0, score: 40 }) as PoseResult | null,
    })

    rerender(frame({ reps: 1, score: 65 }))
    rerender(frame({ reps: 1, score: 90 })) // same rep, refined score — must not push
    rerender(frame({ reps: 2, score: 70 }))

    expect(result.current.snapshot().repScores).toEqual([65, 70])
  })

  it("builds a hold timeline for plank (reps stays 0, hold_s present)", () => {
    const { result, rerender } = renderHook((r: PoseResult | null) => useSessionStats(r), {
      initialProps: frame({ reps: 0, score: 88, hold_s: 1.0 }) as PoseResult | null,
    })

    rerender(frame({ reps: 0, score: 90, hold_s: 2.0 }))
    rerender(frame({ reps: 0, score: 84, hold_s: 3.0 }))

    const snap = result.current.snapshot()
    expect(snap.repScores).toEqual([]) // no reps → no per-rep bars
    expect(snap.holdSeries).toEqual([88, 90, 84])
  })

  it("reset clears the rep and hold timelines", () => {
    const { result, rerender } = renderHook((r: PoseResult | null) => useSessionStats(r), {
      initialProps: frame({ reps: 1, score: 70 }) as PoseResult | null,
    })
    rerender(frame({ reps: 2, score: 75 }))

    result.current.reset()
    const snap = result.current.snapshot()
    expect(snap.reps).toBe(0)
    expect(snap.repScores).toEqual([])
    expect(snap.holdSeries).toEqual([])
  })
})
