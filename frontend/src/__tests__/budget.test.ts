import { describe, expect, it } from "vitest"

import {
  ACTIVITIES,
  activityEquivalents,
  kcalPerMinute,
  progressFraction,
  REFERENCE_BODY_WEIGHT_KG,
  remainingOf,
} from "../lib/budget"

describe("remainingOf", () => {
  it("subtracts consumed from the target", () => {
    const r = remainingOf(2000, 1250)
    expect(r).toEqual({ target: 2000, consumed: 1250, remaining: 750, over: false })
  })

  it("goes negative and flags `over` past the target", () => {
    const r = remainingOf(2000, 2320)
    expect(r?.remaining).toBe(-320)
    expect(r?.over).toBe(true)
  })

  it("treats exactly on target as not over", () => {
    expect(remainingOf(2000, 2000)?.over).toBe(false)
  })

  it("rounds to one decimal so float sums don't leak into the UI", () => {
    expect(remainingOf(150, 0.95 + 8.63)?.remaining).toBe(140.4)
  })

  it("returns null when the nutrient isn't tracked", () => {
    expect(remainingOf(null, 100)).toBeNull()
    expect(remainingOf(undefined, 100)).toBeNull()
    expect(remainingOf(Number.NaN, 100)).toBeNull()
  })

  it("treats a zero target as a real target, not as untracked", () => {
    expect(remainingOf(0, 10)).not.toBeNull()
    expect(remainingOf(0, 10)?.over).toBe(true)
  })
})

describe("progressFraction", () => {
  it("is the consumed share of the target, clamped to 0–1", () => {
    expect(progressFraction({ target: 2000, consumed: 500, remaining: 1500, over: false })).toBe(
      0.25,
    )
    expect(progressFraction({ target: 2000, consumed: 3000, remaining: -1000, over: true })).toBe(1)
  })

  it("does not divide by a zero target", () => {
    expect(progressFraction({ target: 0, consumed: 0, remaining: 0, over: false })).toBe(0)
    expect(progressFraction({ target: 0, consumed: 5, remaining: -5, over: true })).toBe(1)
  })
})

describe("activity equivalent", () => {
  it("uses the standard MET formula: MET × 3.5 × kg / 200", () => {
    // 4.3 MET at 70 kg → 4.3 × 3.5 × 70 / 200 = 5.2675 kcal/min
    expect(kcalPerMinute(4.3, 70)).toBeCloseTo(5.2675, 4)
    expect(kcalPerMinute(4.3)).toBe(kcalPerMinute(4.3, REFERENCE_BODY_WEIGHT_KG))
  })

  it("scales minutes with intensity — a jog needs fewer than a walk", () => {
    const eq = activityEquivalents(320)
    expect(eq.map((a) => a.key)).toEqual(["walk", "cycle", "jog"])
    const walk = eq.find((a) => a.key === "walk")
    const jog = eq.find((a) => a.key === "jog")
    // 320 / 5.2675 ≈ 60.7 min → 60; 320 / 10.17 ≈ 31.5 min → 30.
    expect(walk?.minutes).toBe(60)
    expect(jog?.minutes).toBe(30)
    expect(jog?.minutes).toBeLessThan(walk?.minutes ?? 0)
  })

  it("rounds to 5-minute steps — the estimate is rough by design", () => {
    for (const a of activityEquivalents(437)) expect(a.minutes % 5).toBe(0)
  })

  it("floors at 5 minutes rather than showing an absurd '0 min'", () => {
    for (const a of activityEquivalents(3)) expect(a.minutes).toBe(5)
  })

  it("gives nothing back when there is no surplus", () => {
    expect(activityEquivalents(0)).toEqual([])
    expect(activityEquivalents(-100)).toEqual([])
    expect(activityEquivalents(Number.NaN)).toEqual([])
  })

  it("offers only everyday, low-intensity activities (health-values guardrail)", () => {
    expect(ACTIVITIES).toHaveLength(3)
    for (const a of ACTIVITIES) {
      expect(a.met).toBeLessThanOrEqual(9)
      expect(a.label).not.toMatch(/burn|punish|work off|compensat/i)
    }
  })
})
