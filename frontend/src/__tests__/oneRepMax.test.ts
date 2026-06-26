import { describe, expect, it } from "vitest"

import { oneRepMax } from "../lib/oneRepMax"

describe("oneRepMax (Epley)", () => {
  it("returns bare weight for 0 reps", () => {
    expect(oneRepMax(100, 0)).toBe(100)
  })

  it("returns bare weight for negative reps", () => {
    expect(oneRepMax(80, -1)).toBe(80)
  })

  it("computes 1RM for 10 reps at 100 kg → 133.33", () => {
    expect(oneRepMax(100, 10)).toBeCloseTo(133.33, 1)
  })

  it("computes 1RM for 5 reps at 60 kg → 70", () => {
    expect(oneRepMax(60, 5)).toBeCloseTo(70, 1)
  })

  it("computes 1RM for 1 rep → weight × (1 + 1/30)", () => {
    expect(oneRepMax(100, 1)).toBeCloseTo(103.33, 1)
  })
})
