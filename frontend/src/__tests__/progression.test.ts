import { describe, expect, it } from "vitest"

import { personalRecord, sessionSeries } from "../lib/progression"
import type { ExerciseHistoryOut } from "../types"

const HISTORY: ExerciseHistoryOut = {
  slug: "barbell-squat",
  name: "Barbell Squat",
  total_sets: 4,
  total_volume_kg: 1815,
  best_one_rep_max: 116.7,
  entries: [
    // Newest workout first (API order), two sets each.
    {
      workout_id: "w2",
      performed_at: "2026-07-02T10:00:00Z",
      weight_kg: 105,
      reps: 3,
      est_one_rep_max: 115.5,
    },
    {
      workout_id: "w2",
      performed_at: "2026-07-02T10:00:00Z",
      weight_kg: 100,
      reps: 5,
      est_one_rep_max: 116.7,
    },
    {
      workout_id: "w1",
      performed_at: "2026-07-01T10:00:00Z",
      weight_kg: 100,
      reps: 4,
      est_one_rep_max: 113.3,
    },
    {
      workout_id: "w1",
      performed_at: "2026-07-01T10:00:00Z",
      weight_kg: 100,
      reps: 3,
      est_one_rep_max: 110.0,
    },
  ],
}

const EMPTY: ExerciseHistoryOut = {
  slug: "cable-fly",
  name: "Cable Fly",
  total_sets: 0,
  total_volume_kg: 0,
  best_one_rep_max: 0,
  entries: [],
}

describe("sessionSeries", () => {
  it("groups entries by workout into chronological points", () => {
    const series = sessionSeries(HISTORY)
    expect(series.map((p) => p.workoutId)).toEqual(["w1", "w2"])
    expect(series[0].date).toBe("2026-07-01T10:00:00Z")
  })

  it("takes the best e1RM and sums the volume per session", () => {
    const [w1, w2] = sessionSeries(HISTORY)
    expect(w1.bestE1rm).toBe(113.3)
    expect(w1.volumeKg).toBe(100 * 4 + 100 * 3)
    expect(w2.bestE1rm).toBe(116.7)
    expect(w2.volumeKg).toBe(105 * 3 + 100 * 5)
  })

  it("returns an empty series for an unlogged exercise", () => {
    expect(sessionSeries(EMPTY)).toEqual([])
  })
})

describe("personalRecord", () => {
  it("returns the set with the highest estimated 1RM", () => {
    const pr = personalRecord(HISTORY)
    expect(pr).not.toBeNull()
    expect(pr?.weight_kg).toBe(100)
    expect(pr?.reps).toBe(5)
    expect(pr?.est_one_rep_max).toBe(116.7)
  })

  it("returns null when there is no history", () => {
    expect(personalRecord(EMPTY)).toBeNull()
  })
})
