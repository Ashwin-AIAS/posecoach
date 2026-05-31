import { describe, expect, it } from "vitest"

import {
  CONF_HIGH,
  CONF_LOW,
  KEYPOINT_COUNT,
  KP,
  SKELETON_EDGES,
  confidenceColor,
  scoreColor,
} from "../lib/skeleton"

describe("skeleton constants", () => {
  it("has 17 COCO keypoint indices, 0..16", () => {
    expect(KEYPOINT_COUNT).toBe(17)
    expect(KP.NOSE).toBe(0)
    expect(KP.RIGHT_ANKLE).toBe(16)
  })

  it("references only valid keypoint indices in every skeleton edge", () => {
    for (const [a, b] of SKELETON_EDGES) {
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThan(KEYPOINT_COUNT)
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThan(KEYPOINT_COUNT)
      expect(a).not.toBe(b)
    }
  })

  it("contains the core human skeleton edges", () => {
    const has = (a: number, b: number): boolean =>
      SKELETON_EDGES.some(
        ([x, y]) => (x === a && y === b) || (x === b && y === a),
      )
    expect(has(KP.LEFT_SHOULDER, KP.RIGHT_SHOULDER)).toBe(true)
    expect(has(KP.LEFT_HIP, KP.RIGHT_HIP)).toBe(true)
    expect(has(KP.LEFT_HIP, KP.LEFT_KNEE)).toBe(true)
    expect(has(KP.LEFT_KNEE, KP.LEFT_ANKLE)).toBe(true)
  })
})

describe("confidenceColor", () => {
  it("returns green for high confidence", () => {
    expect(confidenceColor(0.95)).toBe("#36D399")
    expect(confidenceColor(CONF_HIGH)).toBe("#36D399")
  })

  it("returns amber for medium confidence", () => {
    expect(confidenceColor(0.5)).toBe("#FFB23D")
    expect(confidenceColor(CONF_LOW)).toBe("#FFB23D")
  })

  it("returns transparent below the low threshold", () => {
    expect(confidenceColor(0.2)).toBe("transparent")
    expect(confidenceColor(0)).toBe("transparent")
  })
})

describe("scoreColor", () => {
  it("returns green for excellent form", () => {
    expect(scoreColor(95)).toBe("#36D399")
    expect(scoreColor(80)).toBe("#36D399")
  })

  it("returns amber for ok form", () => {
    expect(scoreColor(70)).toBe("#FFB23D")
    expect(scoreColor(60)).toBe("#FFB23D")
  })

  it("returns red for poor form", () => {
    expect(scoreColor(40)).toBe("#FF4D4D")
    expect(scoreColor(0)).toBe("#FF4D4D")
  })

  it("returns gray when score is unknown", () => {
    expect(scoreColor(null)).toBe("#6B7280")
  })
})
