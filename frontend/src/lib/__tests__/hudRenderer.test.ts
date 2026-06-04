import { describe, expect, it, vi } from "vitest"

import { renderHud } from "../hudRenderer"
import type { HudScene } from "../hudRenderer"
import type { WorstJoint } from "../joints"
import type { PoseResult } from "../../types"

/**
 * jsdom has no real 2D context, so we hand `renderHud` a fully mocked ctx and
 * assert the chip text it draws. `canvas: undefined` makes `glassChip` skip its
 * blur-sample path (which would need a real backing canvas).
 */
function mockCtx(): { ctx: CanvasRenderingContext2D; fillText: ReturnType<typeof vi.fn> } {
  const fillText = vi.fn()
  const ctx = {
    canvas: undefined,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    arcTo: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    stroke: vi.fn(),
    drawImage: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    fillText,
    measureText: vi.fn((t: string) => ({ width: t.length * 8 })),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineCap: "butt",
    filter: "none",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
  } as unknown as CanvasRenderingContext2D
  return { ctx, fillText }
}

const baseResult: PoseResult = {
  keypoints: [],
  confidence: [],
  score: 82,
  cues: ["Drive knees out wider"],
  latency_ms: 40,
  reps: 5,
}

function scene(overrides: Partial<HudScene> = {}): HudScene {
  return { result: baseResult, exercise: "squat", worst: null, scale: 1, ...overrides }
}

function drawnTexts(fillText: ReturnType<typeof vi.fn>): string[] {
  return fillText.mock.calls.map((c) => String(c[0]))
}

const worst: WorstJoint = {
  key: "left_knee_angle",
  keypointIndex: 13,
  bodyPart: "left knee",
  score: 40,
}

describe("renderHud", () => {
  it("draws the score number and rep count", () => {
    const { ctx, fillText } = mockCtx()
    renderHud(ctx, 640, 480, scene())
    const texts = drawnTexts(fillText)
    expect(texts).toContain("82") // score ring value
    expect(texts).toContain("5") // rep counter
    expect(texts).toContain("reps")
    expect(texts).toContain("Drive knees out wider") // cue caption
  })

  it('draws the "Fix:" worst-joint chip when a worst joint is set', () => {
    const { ctx, fillText } = mockCtx()
    renderHud(ctx, 640, 480, scene({ worst }))
    expect(drawnTexts(fillText)).toContain("Fix: left knee")
  })

  it("shows hold seconds instead of reps for plank", () => {
    const { ctx, fillText } = mockCtx()
    const plank: PoseResult = { ...baseResult, hold_s: 12.4 }
    renderHud(ctx, 640, 480, scene({ result: plank, exercise: "plank" }))
    const texts = drawnTexts(fillText)
    expect(texts).toContain("12.4s")
    expect(texts).toContain("hold")
    expect(texts).not.toContain("reps")
  })

  it("renders a — for a null score", () => {
    const { ctx, fillText } = mockCtx()
    renderHud(ctx, 640, 480, scene({ result: { ...baseResult, score: null } }))
    expect(drawnTexts(fillText)).toContain("—")
  })

  it("draws the status banner (not cue/worst chip) when a frame is blocked", () => {
    const { ctx, fillText } = mockCtx()
    const blocked: PoseResult = {
      ...baseResult,
      score: null,
      cues: ["Position yourself in frame"],
      status: "insufficient_confidence",
    }
    renderHud(ctx, 640, 480, scene({ result: blocked, worst }))
    const texts = drawnTexts(fillText)
    expect(texts).toContain("Position yourself in frame") // center banner
    expect(texts).not.toContain("Fix: left knee") // worst chip suppressed
  })

  it("falls back to default banner copy when a blocked frame has no cue", () => {
    const { ctx, fillText } = mockCtx()
    const noPerson: PoseResult = { ...baseResult, score: null, cues: [], status: "no_person" }
    renderHud(ctx, 640, 480, scene({ result: noPerson }))
    expect(drawnTexts(fillText)).toContain("Step into frame")
  })
})
