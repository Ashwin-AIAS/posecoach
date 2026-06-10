import { describe, expect, it } from "vitest"

import type { PoseError, PoseResult } from "../types"
import { EXERCISES, isPoseError } from "../types"

describe("EXERCISES list", () => {
  it("keeps the original 7 thesis-supported exercises at the front", () => {
    expect(EXERCISES.slice(0, 7)).toEqual([
      "squat",
      "deadlift",
      "curl",
      "bench",
      "ohp",
      "lunge",
      "plank",
    ])
  })

  it("exposes the full expanded set with no duplicates", () => {
    expect(EXERCISES.length).toBe(18)
    expect(new Set(EXERCISES).size).toBe(EXERCISES.length)
  })
})

describe("isPoseError", () => {
  it("returns true for error payloads", () => {
    const err: PoseError = { error: "unsupported exercise 'foo'" }
    expect(isPoseError(err)).toBe(true)
  })

  it("returns false for pose result payloads", () => {
    const result: PoseResult = {
      keypoints: [],
      confidence: [],
      score: 85,
      cues: [],
      latency_ms: 42,
    }
    expect(isPoseError(result)).toBe(false)
  })
})
