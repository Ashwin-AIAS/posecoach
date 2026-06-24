import { describe, expect, it } from "vitest"

import { computeCoverProjection, holdOpacity, screenX, screenY } from "../poseRenderer"

/**
 * Guards docs/enhancements/FIX_BACK_CAMERA_POSE_QUALITY.md Phase 3: keypoints
 * must be projected through the same object-cover transform the live
 * <video> is displayed with, or the skeleton drifts off the body whenever the
 * video's aspect ratio differs from the stage's (e.g. a 16:9 back camera in a
 * portrait stage).
 */
describe("computeCoverProjection / screenX / screenY", () => {
  it("is the identity when the video aspect matches the stage aspect", () => {
    const proj = computeCoverProjection(400, 300, 800, 600) // both 4:3
    expect(proj.offX).toBeCloseTo(0)
    expect(proj.offY).toBeCloseTo(0)
    expect(screenX(0.5, proj, false)).toBeCloseTo(200)
    expect(screenY(0.5, proj)).toBeCloseTo(150)
  })

  it("crops a 16:9 video on a portrait stage — nx=0 lands left of the canvas, not at 0", () => {
    const W = 390
    const H = 700
    const proj = computeCoverProjection(W, H, 1280, 720)

    // The video is scaled up until it covers the full portrait stage
    // vertically, overflowing horizontally — so the left edge of the frame
    // (nx=0) is cropped off-screen, not pinned to x=0 like the old plain
    // `nx*W` projection assumed.
    const x = screenX(0, proj, false)
    expect(x).toBeLessThan(0)
    expect(x).not.toBe(0)

    // The vertical extent fully fills the stage (no vertical crop for this
    // aspect combination): ny=0 and ny=1 land exactly on the canvas edges.
    expect(screenY(0, proj)).toBeCloseTo(0)
    expect(screenY(1, proj)).toBeCloseTo(H)
  })

  it("mirrors correctly under a cover crop", () => {
    const proj = computeCoverProjection(390, 700, 1280, 720)
    const x = screenX(0, proj, false)
    const xMirrored = screenX(0, proj, true)
    // Mirroring nx=0 is equivalent to projecting nx=1 unmirrored.
    expect(xMirrored).toBeCloseTo(screenX(1, proj, false))
    expect(xMirrored).not.toBeCloseTo(x)
  })

  it("falls back to no crop when video dimensions are unknown (zero)", () => {
    const proj = computeCoverProjection(390, 700, 0, 0)
    expect(proj).toEqual({ dispW: 390, dispH: 700, offX: 0, offY: 0 })
  })

  it("keeps a mid-body keypoint on the body for a 9:16 portrait camera (Phase 6 regression)", () => {
    // A portrait phone camera (9:16) on a portrait stage: a mid-body keypoint at
    // (0.5, 0.5) must land at the stage center within a few px, not drift off the
    // body — the property a future projection re-break would violate.
    const W = 390
    const H = 700
    const proj = computeCoverProjection(W, H, 1080, 1920)
    expect(screenX(0.5, proj, false)).toBeCloseTo(W / 2, 0)
    expect(screenY(0.5, proj)).toBeCloseTo(H / 2, 0)
    // No NaN/Infinity leaks through the transform.
    expect(Number.isFinite(screenX(0.5, proj, false))).toBe(true)
    expect(Number.isFinite(screenY(0.5, proj))).toBe(true)
  })
})

describe("holdOpacity (hold-last-pose hysteresis, Phase 3)", () => {
  const HOLD = 400

  it("is full opacity at the instant of the gap", () => {
    expect(holdOpacity(0, HOLD)).toBe(1)
  })

  it("a single dropped frame (small elapsed) still draws the skeleton", () => {
    // ~one 30fps frame (33ms) into a gap — must stay clearly visible, not blank.
    expect(holdOpacity(33, HOLD)).toBeGreaterThan(0.9)
  })

  it("fades linearly across the hold window", () => {
    expect(holdOpacity(200, HOLD)).toBeCloseTo(0.5)
  })

  it("blanks once the hold window has fully elapsed", () => {
    expect(holdOpacity(400, HOLD)).toBe(0)
    expect(holdOpacity(500, HOLD)).toBe(0)
  })

  it("is 0 for a non-positive hold window", () => {
    expect(holdOpacity(10, 0)).toBe(0)
  })
})
