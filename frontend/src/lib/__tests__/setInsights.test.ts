import { describe, expect, it } from "vitest"

import {
  computeSetInsights,
  computeVerdict,
  detectFatigueDrop,
  isPersonalBestSet,
  priorSessionsFromHistory,
} from "../setInsights"
import type { SetInsightInput } from "../setInsights"

const NOW = Date.parse("2026-11-27T12:00:00Z")

function makeInput(overrides: Partial<SetInsightInput> = {}): SetInsightInput {
  return {
    exerciseId: "squat",
    exerciseLabel: "Squat",
    reps: 6,
    avgScore: 82,
    bestScore: 90,
    samples: 90,
    repScores: [82, 84, 83, 81, 82, 80],
    worstJoint: null,
    history: [],
    nowMs: NOW,
    ...overrides,
  }
}

describe("computeVerdict", () => {
  it.each([
    {
      name: "empty 0-sample set",
      overrides: { reps: 0, avgScore: 0, bestScore: 0, samples: 0, repScores: [] },
      expected: "No scored reps yet",
    },
    {
      name: "clean high-scoring set",
      overrides: { avgScore: 86, worstJoint: null },
      expected: "Clean set",
    },
    {
      name: "moderate set with knee fault",
      overrides: { avgScore: 74, worstJoint: "left_knee_angle" },
      expected: "Good set — watch your knees",
    },
    {
      name: "moderate set without fault joint",
      overrides: { avgScore: 74, worstJoint: null },
      expected: "Good set — stay controlled",
    },
    {
      name: "late-set breakdown",
      overrides: { avgScore: 71, repScores: [86, 85, 78, 74, 58, 56] },
      expected: "Form broke down late",
    },
    {
      name: "low score with trunk fault",
      overrides: { avgScore: 55, worstJoint: "hip_trunk_angle" },
      expected: "Tough set — focus on your core",
    },
  ])("returns '$expected' for $name", ({ overrides, expected }) => {
    expect(computeVerdict(makeInput(overrides))).toBe(expected)
  })
})

describe("detectFatigueDrop", () => {
  it("flags contiguous late-set drops (>= 12 pts below prior mean and < 75)", () => {
    expect(detectFatigueDrop([84, 86, 83, 82, 59, 57])).toEqual({
      startRep: 5,
      endRep: 6,
      dropMean: 58,
    })
  })

  it("returns null when reps stay consistent", () => {
    expect(detectFatigueDrop([82, 84, 81, 83, 80, 82])).toBeNull()
  })
})

describe("computeSetInsights", () => {
  it("produces fatigue, history delta, and respects <= 3 insights and <= 12 words each", () => {
    const insights = computeSetInsights(
      makeInput({
        avgScore: 81,
        repScores: [86, 88, 85, 84, 59, 57],
        worstJoint: "left_knee_angle",
        history: [
          { exercise: "squat", avg_form_score: 75, started_at: "2026-11-25T10:00:00Z" },
        ],
      }),
    )
    expect(insights).toContain("Reps 5–6 dropped to 58 — fatigue?")
    expect(insights).toContain("Avg 81, +6 vs your last Squat")
    expect(insights.length).toBeGreaterThanOrEqual(2)
    expect(insights.length).toBeLessThanOrEqual(3)
    for (const line of insights) {
      expect(line.split(/\s+/).length).toBeLessThanOrEqual(12)
    }
  })

  it("flags 'Most consistent set this week' when stdDev is tight and recent history exists", () => {
    const insights = computeSetInsights(
      makeInput({
        avgScore: 84,
        repScores: [83, 85, 84, 84, 83, 85],
        history: [
          { exercise: "bench", avg_form_score: 79, started_at: "2026-11-26T10:00:00Z" },
        ],
      }),
    )
    expect(insights).toContain("Most consistent set this week")
  })

  it("never compares against a different exercise's history", () => {
    const insights = computeSetInsights(
      makeInput({
        exerciseId: "squat",
        exerciseLabel: "Squat",
        avgScore: 78,
        repScores: [76, 80, 78],
        history: [
          { exercise: "deadlift", avg_form_score: 95, started_at: "2026-11-26T10:00:00Z" },
        ],
      }),
    )
    expect(insights.some((s) => s.includes("vs your last"))).toBe(false)
  })

  it("returns empty array when no frames were scored", () => {
    expect(computeSetInsights(makeInput({ samples: 0, reps: 0, repScores: [] }))).toEqual([])
  })

  it("is 100% deterministic for identical inputs", () => {
    const input = makeInput({
      avgScore: 79,
      repScores: [82, 81, 80, 73],
      worstJoint: "right_hip_angle",
      history: [{ exercise: "squat", avg_form_score: 74, started_at: "2026-11-24T10:00:00Z" }],
    })
    expect(computeSetInsights(input)).toEqual(computeSetInsights(input))
  })
})

describe("isPersonalBestSet & priorSessionsFromHistory", () => {
  it("detects a personal best only against prior sessions of the same exercise", () => {
    expect(
      isPersonalBestSet(
        makeInput({
          avgScore: 89,
          history: [
            { exercise: "squat", avg_form_score: 85, started_at: "2026-11-20T10:00:00Z" },
            { exercise: "deadlift", avg_form_score: 96, started_at: "2026-11-21T10:00:00Z" },
          ],
        }),
      ),
    ).toBe(true)
  })

  it("strips the just-finished duplicate session from history when within 2 minutes", () => {
    const prior = priorSessionsFromHistory(
      [
        { id: "new", exercise: "squat", avg_form_score: 82, started_at: "2026-11-27T11:59:30Z" },
        { id: "old", exercise: "squat", avg_form_score: 76, started_at: "2026-11-25T10:00:00Z" },
      ],
      "squat",
      82,
      90,
      NOW,
    )
    expect(prior.map((s) => s.id)).toEqual(["old"])
  })
})
