import { describe, expect, it } from "vitest"

import { bodyExtent, isFarSubject } from "../framing"
import type { Keypoint } from "../../types"

/**
 * Far-subject framing detection (FIX_POSE_TRACKING_QUALITY §3E/Phase 5): nudge
 * the user closer when a tracked body fills too little of the frame.
 */

/** 17 keypoints spread over a normalized [cx±half] box, all fully confident. */
function bodyBox(cx: number, cy: number, half: number): {
  keypoints: Keypoint[]
  confidence: number[]
} {
  const keypoints: Keypoint[] = []
  for (let i = 0; i < 17; i++) {
    // Alternate corners so the bounding box spans 2*half on each axis.
    const sx = i % 2 === 0 ? -1 : 1
    const sy = i % 3 === 0 ? -1 : 1
    keypoints.push([cx + sx * half, cy + sy * half])
  }
  return { keypoints, confidence: new Array(17).fill(0.9) }
}

describe("bodyExtent", () => {
  it("returns the larger normalized span of confident keypoints", () => {
    const { keypoints, confidence } = bodyBox(0.5, 0.5, 0.3) // spans 0.6
    expect(bodyExtent(keypoints, confidence)).toBeCloseTo(0.6)
  })

  it("returns null when too few keypoints clear the confidence gate", () => {
    const { keypoints } = bodyBox(0.5, 0.5, 0.3)
    const confidence = new Array(17).fill(0.1) // all below the 0.5 gate
    expect(bodyExtent(keypoints, confidence)).toBeNull()
  })
})

describe("isFarSubject", () => {
  it("flags a small, distant body (fills little of the frame)", () => {
    const { keypoints, confidence } = bodyBox(0.5, 0.5, 0.12) // extent 0.24
    expect(isFarSubject(keypoints, confidence)).toBe(true)
  })

  it("does not flag a well-framed body that fills the frame", () => {
    const { keypoints, confidence } = bodyBox(0.5, 0.5, 0.35) // extent 0.70
    expect(isFarSubject(keypoints, confidence)).toBe(false)
  })

  it("does not flag when the body is only partially detected", () => {
    const { keypoints } = bodyBox(0.5, 0.5, 0.12)
    const confidence = new Array(17).fill(0)
    confidence[0] = 0.9
    confidence[5] = 0.9 // only 2 confident keypoints
    expect(isFarSubject(keypoints, confidence)).toBe(false)
  })
})
