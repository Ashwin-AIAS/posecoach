import { describe, expect, it } from "vitest"

import { createPoseInterpolator } from "../lib/poseInterpolator"
import type { Keypoint } from "../types"

/** 17 keypoints all at the same (x, y), all fully confident. */
function frame(x: number, y: number, conf = 1): { kp: Keypoint[]; conf: number[] } {
  return {
    kp: Array.from({ length: 17 }, () => [x, y] as Keypoint),
    conf: Array.from({ length: 17 }, () => conf),
  }
}

describe("createPoseInterpolator", () => {
  it("returns null until a frame is pushed", () => {
    const interp = createPoseInterpolator()
    expect(interp.sample(0)).toBeNull()
  })

  it("returns the only frame verbatim before a second arrives", () => {
    const interp = createPoseInterpolator()
    const a = frame(0.3, 0.4)
    interp.push(a.kp, a.conf, 0)
    const out = interp.sample(50)
    expect(out).not.toBeNull()
    expect(out?.keypoints[0]).toEqual([0.3, 0.4])
  })

  it("interpolates to the midpoint at the newest frame's arrival (0.5 render delay)", () => {
    const interp = createPoseInterpolator()
    const a = frame(0, 0)
    const b = frame(1, 1)
    interp.push(a.kp, a.conf, 0)
    interp.push(b.kp, b.conf, 100) // interval seeded to 100ms
    // At now == b.t, the render parameter is (100-0)/100 - 0.5 = 0.5 → midpoint.
    const out = interp.sample(100)
    expect(out?.keypoints[0][0]).toBeCloseTo(0.5, 6)
    expect(out?.keypoints[0][1]).toBeCloseTo(0.5, 6)
  })

  it("reaches the newest frame half an interval after it arrives", () => {
    const interp = createPoseInterpolator()
    const a = frame(0, 0)
    const b = frame(1, 1)
    interp.push(a.kp, a.conf, 0)
    interp.push(b.kp, b.conf, 100)
    // (150-0)/100 - 0.5 = 1.0 → exactly at cur.
    const out = interp.sample(150)
    expect(out?.keypoints[0][0]).toBeCloseTo(1.0, 6)
  })

  it("caps forward extrapolation when the next frame is late", () => {
    const interp = createPoseInterpolator()
    const a = frame(0, 0)
    const b = frame(1, 1)
    interp.push(a.kp, a.conf, 0)
    interp.push(b.kp, b.conf, 100)
    // Far in the future the parameter saturates at 1 + MAX_EXTRAP (0.5) → 1.5,
    // never running off to infinity on a stale velocity.
    const out = interp.sample(10_000)
    expect(out?.keypoints[0][0]).toBeCloseTo(1.5, 6)
    expect(out?.keypoints[0][1]).toBeCloseTo(1.5, 6)
  })

  it("holds the latest position for joints unreliable in either frame", () => {
    const interp = createPoseInterpolator()
    const a = frame(0, 0)
    const b = frame(1, 1)
    a.conf[0] = 0.1 // joint 0 was gated out in the previous frame
    interp.push(a.kp, a.conf, 0)
    interp.push(b.kp, b.conf, 100)
    const out = interp.sample(100)
    // Joint 0 holds cur (1,1) instead of blending from a garbage prev coord.
    expect(out?.keypoints[0]).toEqual([1, 1])
    // A reliable joint still interpolates to the midpoint.
    expect(out?.keypoints[1][0]).toBeCloseTo(0.5, 6)
  })

  it("reports the latest confidence vector", () => {
    const interp = createPoseInterpolator()
    const a = frame(0, 0, 0.4)
    const b = frame(1, 1, 0.9)
    interp.push(a.kp, a.conf, 0)
    interp.push(b.kp, b.conf, 100)
    const out = interp.sample(120)
    expect(out?.confidence[0]).toBe(0.9)
  })

  it("returns null again after reset", () => {
    const interp = createPoseInterpolator()
    const a = frame(0.2, 0.2)
    interp.push(a.kp, a.conf, 0)
    interp.reset()
    expect(interp.sample(10)).toBeNull()
  })

  it("does not mutate the pushed keypoint arrays", () => {
    const interp = createPoseInterpolator()
    const a = frame(0, 0)
    const b = frame(1, 1)
    interp.push(a.kp, a.conf, 0)
    interp.push(b.kp, b.conf, 100)
    interp.sample(120)
    expect(a.kp[0]).toEqual([0, 0])
    expect(b.kp[0]).toEqual([1, 1])
  })
})
