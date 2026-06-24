import { describe, expect, it } from "vitest"

import { meanLuma } from "../luma"

/**
 * Low-light capture assist (FIX_POSE_TRACKING_QUALITY §3E/Phase 5): mean luma
 * drives whether a dark frame gets a mild brightness lift before encoding.
 */

/** Build a packed RGBA buffer of `n` identical pixels. */
function rgba(r: number, g: number, b: number, n: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  }
  return data
}

describe("meanLuma", () => {
  it("is 0 for an all-black frame", () => {
    expect(meanLuma(rgba(0, 0, 0, 16))).toBe(0)
  })

  it("is 255 for an all-white frame", () => {
    expect(meanLuma(rgba(255, 255, 255, 16))).toBeCloseTo(255)
  })

  it("uses Rec. 601 weighting for a pure-green frame", () => {
    // 0.587 * 255 ≈ 149.7
    expect(meanLuma(rgba(0, 255, 0, 8))).toBeCloseTo(149.7, 1)
  })

  it("is 0 for an empty buffer", () => {
    expect(meanLuma(new Uint8ClampedArray(0))).toBe(0)
  })
})
