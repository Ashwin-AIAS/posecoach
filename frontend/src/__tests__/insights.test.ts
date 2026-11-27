import { describe, expect, it } from "vitest"

import type { HistorySessionRow } from "../hooks/useHistorySessions"
import {
  computeHomeInsights,
  getLastExercise,
  getWorstTrendingExercise,
} from "../lib/insights"

const NOW = new Date("2026-11-27T12:00:00Z")
const DAY_MS = 86_400_000

function session(
  id: string,
  exercise: string,
  score: number,
  daysAgo: number,
  reps = 8,
): HistorySessionRow {
  const started = new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString()
  return {
    id,
    exercise,
    rep_count: reps,
    avg_form_score: score,
    started_at: started,
    ended_at: started,
  }
}

describe("computeHomeInsights (P36 C3)", () => {
  it("returns empty array for empty history", () => {
    expect(computeHomeInsights([], NOW)).toEqual([])
  })

  it("computes positive trend over 2 weeks", () => {
    const rows = [
      session("s1", "deadlift", 88, 1),
      session("s2", "deadlift", 86, 4),
      session("s3", "deadlift", 78, 16),
      session("s4", "deadlift", 78, 20),
    ]
    const insights = computeHomeInsights(rows, NOW)
    const trend = insights.find((i) => i.kind === "trend")
    expect(trend).toBeDefined()
    expect(trend?.title).toBe("Deadlift form +9 over 2 weeks")
    expect(trend?.prompt).toContain("deadlift")
  })

  it("computes negative trend when recent form dropped", () => {
    const rows = [
      session("s1", "squat", 65, 1),
      session("s2", "squat", 80, 18),
    ]
    const insights = computeHomeInsights(rows, NOW)
    const trend = insights.find((i) => i.kind === "trend")
    expect(trend?.title).toBe("Squat form -15 over 2 weeks")
  })

  it("detects neglected movement not trained in >= 7 days", () => {
    const rows = [
      session("s1", "squat", 85, 0),
      session("s2", "bench", 76, 10),
    ]
    const insights = computeHomeInsights(rows, NOW)
    const neglected = insights.find((i) => i.kind === "neglected")
    expect(neglected).toBeDefined()
    expect(neglected?.title).toBe("No bench press in 10 days")
  })

  it("detects weekly consistency best-yet", () => {
    // 2026-11-27 is a Friday; 0, 1, 2, 3 days ago are all in the same ISO week.
    const rows = [
      session("s1", "squat", 82, 0),
      session("s2", "curl", 84, 1),
      session("s3", "bench", 80, 2),
      session("s4", "deadlift", 81, 3),
      session("s5", "squat", 82, 10),
    ]
    const insights = computeHomeInsights(rows, NOW)
    const consistency = insights.find((i) => i.kind === "consistency")
    expect(consistency).toBeDefined()
    expect(consistency?.title).toBe("4 sessions this week — best yet")
  })

  it("caps returned insights at 2 cards maximum", () => {
    const rows = [
      session("s1", "deadlift", 90, 0),
      session("s2", "deadlift", 75, 18),
      session("s3", "bench", 78, 12),
      session("s4", "squat", 85, 1),
      session("s5", "curl", 84, 2),
    ]
    const insights = computeHomeInsights(rows, NOW)
    expect(insights.length).toBeLessThanOrEqual(2)
  })
})

describe("history helpers for Coach AI (P36 C4)", () => {
  it("identifies latest exercise and worst-trending exercise", () => {
    const rows = [
      session("s1", "curl", 85, 2),
      session("s2", "squat", 62, 0),
      session("s3", "squat", 80, 16),
    ]
    expect(getLastExercise(rows)).toBe("squat")
    expect(getWorstTrendingExercise(rows, NOW)).toBe("squat")
  })

  it("returns null for empty history", () => {
    expect(getLastExercise([])).toBeNull()
    expect(getWorstTrendingExercise([], NOW)).toBeNull()
  })
})
