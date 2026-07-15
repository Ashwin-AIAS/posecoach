import { describe, expect, it } from "vitest"

import {
  computeLetterbox,
  decodeTopPerson,
  imageDataToTensor,
  meanPixelDelta,
  unletterboxToNorm,
  type Keypoint640,
} from "../hooks/useOnDeviceInference"

const COLS = 57

/** Build one flat (rows, 57) detection tensor from per-row conf + keypoints. */
function makeDet(rows: { conf: number; kps?: readonly (readonly [number, number, number])[] }[]): Float32Array {
  const det = new Float32Array(rows.length * COLS)
  rows.forEach((row, r) => {
    det[r * COLS + 4] = row.conf
    row.kps?.forEach(([x, y, c], k) => {
      det[r * COLS + 6 + k * 3] = x
      det[r * COLS + 6 + k * 3 + 1] = y
      det[r * COLS + 6 + k * 3 + 2] = c
    })
  })
  return det
}

describe("computeLetterbox", () => {
  it("mirrors the server geometry for a 640x480 source into 640", () => {
    // scale = min(640/640, 640/480) = 1.0 → 640x480 content, 80px top pad
    expect(computeLetterbox(640, 480, 640)).toEqual({
      scale: 1,
      padX: 0,
      padY: 80,
      newW: 640,
      newH: 480,
      srcW: 640,
      srcH: 480,
    })
  })

  it("upscales a 512x384 capture exactly like runner._decode_frame", () => {
    // scale = min(1.25, 1.667) = 1.25 → 640x480 content, 80px top pad
    const m = computeLetterbox(512, 384, 640)
    expect(m.scale).toBe(1.25)
    expect(m.newW).toBe(640)
    expect(m.newH).toBe(480)
    expect(m.padX).toBe(0)
    expect(m.padY).toBe(80)
  })

  it("floor-centres an odd pad like Python's (size-new)//2", () => {
    // 100x99 into 100: newH = 99, pad = (100-99)//2 = 0 (floor)
    const m = computeLetterbox(100, 99, 100)
    expect(m.newH).toBe(99)
    expect(m.padY).toBe(0)
  })
})

describe("imageDataToTensor", () => {
  it("emits BGR planes, /255, CHW", () => {
    // Two pixels: pure red, pure green (alpha ignored).
    const img = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]),
    }
    const t = imageDataToTensor(img)
    // Plane 0 = B: [0, 0]; plane 1 = G: [0, 1]; plane 2 = R: [1, 0]
    expect(Array.from(t)).toEqual([0, 0, 0, 1, 1, 0])
  })

  it("scales channel bytes by 255", () => {
    const img = { width: 1, height: 1, data: new Uint8ClampedArray([51, 102, 204, 255]) }
    const t = imageDataToTensor(img)
    expect(t[0]).toBeCloseTo(204 / 255) // B
    expect(t[1]).toBeCloseTo(102 / 255) // G
    expect(t[2]).toBeCloseTo(51 / 255) // R
  })
})

describe("decodeTopPerson", () => {
  it("argmaxes the score column and slices 17 keypoints — no NMS", () => {
    const det = makeDet([
      { conf: 0.4, kps: [[10, 20, 0.9]] },
      { conf: 0.8, kps: [[100, 200, 0.7]] },
    ])
    const top = decodeTopPerson(det)
    expect(top).not.toBeNull()
    expect(top?.conf).toBeCloseTo(0.8)
    expect(top?.kps).toHaveLength(17)
    expect(top?.kps[0]).toEqual({ x: 100, y: 200, conf: expect.closeTo(0.7) })
  })

  it("returns null below the 0.10 detection gate (server parity)", () => {
    expect(decodeTopPerson(makeDet([{ conf: 0.05 }]))).toBeNull()
  })

  it("returns null on an empty tensor", () => {
    expect(decodeTopPerson(new Float32Array(0))).toBeNull()
  })
})

describe("unletterboxToNorm", () => {
  it("inverts the pad/scale back to source-frame normalized coords", () => {
    const meta = computeLetterbox(512, 384, 640) // pad_y 80, content 640x480
    const kps: Keypoint640[] = [{ x: 320, y: 320, conf: 0.9 }]
    const [n] = unletterboxToNorm(kps, meta)
    expect(n.xn).toBeCloseTo(0.5) // (320-0)/640
    expect(n.yn).toBeCloseTo(0.5) // (320-80)/480
    expect(n.conf).toBe(0.9)
  })

  it("clamps outside-the-content coordinates into [0,1]", () => {
    const meta = computeLetterbox(512, 384, 640)
    const [n] = unletterboxToNorm([{ x: 0, y: 0, conf: 1 }], meta) // in the pad band
    expect(n.yn).toBe(0)
  })
})

describe("meanPixelDelta", () => {
  it("averages distances over joints clearing 0.5 on BOTH sides", () => {
    const local = [
      { xn: 0.5, yn: 0.5, conf: 0.9 },
      { xn: 0.2, yn: 0.2, conf: 0.9 },
      { xn: 0.8, yn: 0.8, conf: 0.3 }, // local below gate — excluded
    ]
    const server = [
      [0.5, 0.6], // dy = 0.1 * 100 = 10px
      [0.2, 0.2], // exact match
      [0.8, 0.8],
    ]
    const conf = [0.9, 0.4, 0.9] // server joint 1 below gate — excluded
    const d = meanPixelDelta(local, server, conf, 100, 100)
    expect(d).not.toBeNull()
    expect(d?.joints).toBe(1)
    expect(d?.meanPx).toBeCloseTo(10)
  })

  it("returns null when no joint clears both gates", () => {
    const d = meanPixelDelta([{ xn: 0, yn: 0, conf: 0.1 }], [[0, 0]], [0.9], 100, 100)
    expect(d).toBeNull()
  })
})
