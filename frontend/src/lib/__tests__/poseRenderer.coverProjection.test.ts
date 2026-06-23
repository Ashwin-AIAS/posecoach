import { describe, expect, it } from "vitest"

import { computeCoverProjection, screenX, screenY } from "../poseRenderer"

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
})
