import { describe, expect, it } from "vitest"

import type { PoseError, PoseResult } from "../types"
import { EXERCISES, isPoseError } from "../types"

describe("EXERCISES list", () => {
  it("contains all 7 thesis-supported exercises", () => {
    expect(EXERCISES).toEqual(["squat", "deadlift", "curl", "bench", "ohp", "lunge", "plank"])
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
