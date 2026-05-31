import { describe, expect, it } from "vitest"

import {
  EXERCISE_CATEGORIES,
  EXERCISE_META,
  EXERCISE_META_LIST,
  exercisesByCategory,
  type ExerciseCategory,
} from "../lib/exercises"
import { EXERCISES } from "../types"

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/

describe("exercise metadata", () => {
  it("has metadata for every supported exercise and nothing extra", () => {
    expect(Object.keys(EXERCISE_META).sort()).toEqual([...EXERCISES].sort())
    expect(EXERCISE_META_LIST).toHaveLength(EXERCISES.length)
  })

  it("gives every exercise a curated, well-formed YouTube demo id", () => {
    for (const ex of EXERCISES) {
      const { youtubeId } = EXERCISE_META[ex]
      expect(youtubeId, `${ex} is missing a youtubeId`).toBeTruthy()
      expect(youtubeId, `${ex} has a malformed youtubeId: ${youtubeId}`).toMatch(YOUTUBE_ID)
    }
  })

  it("uses a distinct demo video per exercise", () => {
    const ids = EXERCISE_META_LIST.map((m) => m.youtubeId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("gives every exercise a label, a valid category, and at least one muscle", () => {
    const categories = new Set<ExerciseCategory>(EXERCISE_CATEGORIES)
    for (const meta of EXERCISE_META_LIST) {
      expect(meta.label.trim().length).toBeGreaterThan(0)
      expect(categories.has(meta.category)).toBe(true)
      expect(meta.primaryMuscles.length).toBeGreaterThan(0)
    }
  })

  it("groups every exercise into exactly one category section", () => {
    const grouped = exercisesByCategory().flatMap((g) => g.items)
    expect(grouped).toHaveLength(EXERCISES.length)
    expect(new Set(grouped.map((m) => m.id)).size).toBe(EXERCISES.length)
  })
})
