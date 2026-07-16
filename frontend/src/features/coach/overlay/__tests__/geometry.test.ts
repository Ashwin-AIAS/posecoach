import { describe, expect, it } from "vitest"

import { angle, arcSweep, computeCoverProjection, toCanvasXY } from "../geometry"

describe("angle", () => {
  it("returns 90 for an L-shape", () => {
    const a = { x: 0, y: -1 }
    const b = { x: 0, y: 0 }
    const c = { x: 1, y: 0 }
    expect(angle(a, b, c)).toBeCloseTo(90, 5)
  })

  it("returns 180 for collinear points", () => {
    const a = { x: -1, y: 0 }
    const b = { x: 0, y: 0 }
    const c = { x: 1, y: 0 }
    expect(angle(a, b, c)).toBeCloseTo(180, 5)
  })

  it("returns 0 when both rays point the same direction", () => {
    const a = { x: 1, y: 0 }
    const b = { x: 0, y: 0 }
    const c = { x: 2, y: 0 }
    expect(angle(a, b, c)).toBeCloseTo(0, 5)
  })

  it("is orientation-independent (swapping a and c is unchanged)", () => {
    const a = { x: 3, y: 1 }
    const b = { x: 1, y: 1 }
    const c = { x: 1, y: 4 }
    expect(angle(a, b, c)).toBeCloseTo(angle(c, b, a), 10)
  })

  it("returns 0 for a degenerate vertex instead of NaN", () => {
    const a = { x: 0, y: 0 }
    const b = { x: 0, y: 0 }
    const c = { x: 1, y: 0 }
    expect(angle(a, b, c)).toBe(0)
  })
})

describe("computeCoverProjection", () => {
  it("scales a wider-than-canvas video and centers it horizontally", () => {
    // canvas 100x100, video 200x100 -> cover scale = max(0.5, 1) = 1
    const proj = computeCoverProjection(100, 100, 200, 100)
    expect(proj.drawW).toBeCloseTo(200)
    expect(proj.drawH).toBeCloseTo(100)
    expect(proj.offX).toBeCloseTo(50)
    expect(proj.offY).toBeCloseTo(0)
  })

  it("falls back to an identity projection for a zero-sized input", () => {
    const proj = computeCoverProjection(0, 100, 200, 100)
    expect(proj).toEqual({ drawW: 0, drawH: 100, offX: 0, offY: 0 })
  })
})

describe("toCanvasXY", () => {
  const proj = computeCoverProjection(100, 100, 200, 100) // drawW=200 drawH=100 offX=50 offY=0

  it.each([
    // [nx, ny, mirrored, expected x, expected y]
    [0.5, 0.5, false, 50, 50],
    [0.25, 0.5, true, 100, 50],
    [0, 0, false, -50, 0],
    [1, 1, false, 150, 100],
  ] as const)("maps (%p,%p) mirrored=%p -> (%p,%p)", (nx, ny, mirrored, ex, ey) => {
    const p = toCanvasXY(nx, ny, mirrored, proj)
    expect(p.x).toBeCloseTo(ex)
    expect(p.y).toBeCloseTo(ey)
  })
})

describe("arcSweep", () => {
  it("picks the shorter (non-reflex) sweep for a right angle", () => {
    const a = { x: 0, y: -1 }
    const b = { x: 0, y: 0 }
    const c = { x: 1, y: 0 }
    const sweep = arcSweep(a, b, c)
    expect(sweep.startAngle).toBeCloseTo(-Math.PI / 2)
    expect(sweep.endAngle).toBeCloseTo(0)
    expect(sweep.anticlockwise).toBe(false)
  })
})
