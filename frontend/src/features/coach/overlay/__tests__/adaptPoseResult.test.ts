import { describe, expect, it } from "vitest"

import { toOverlayFrame } from "../adaptPoseResult"
import type { PoseResult } from "../../../../types"

const BASE: PoseResult = {
  keypoints: [
    [0.5, 0.1],
    [0.5, 0.1],
    [0.5, 0.1],
    [0.5, 0.1],
    [0.5, 0.1],
    [0.42, 0.22],
    [0.58, 0.22],
    [0.4, 0.35],
    [0.6, 0.35],
    [0.39, 0.47],
    [0.61, 0.47],
    [0.45, 0.5],
    [0.55, 0.5],
    [0.44, 0.7],
    [0.56, 0.7],
    [0.45, 0.9],
    [0.55, 0.9],
  ],
  confidence: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9],
  score: 88,
  cues: ["Nice depth"],
  latency_ms: 40,
  reps: 1,
}

describe("toOverlayFrame", () => {
  it("returns an all-null idle frame for a null result", () => {
    const frame = toOverlayFrame(null, true)
    expect(frame.state).toBe("idle")
    expect(frame.formScore).toBeNull()
    expect(frame.cue).toBeNull()
    expect(frame.keypoints).toHaveLength(17)
    expect(frame.keypoints.every((kp) => kp === null)).toBe(true)
    expect(frame.mirrored).toBe(true)
  })

  it("gates keypoints below the 0.5 confidence threshold to null", () => {
    const result: PoseResult = {
      ...BASE,
      confidence: BASE.confidence.map((c, i) => (i === 13 ? 0.3 : c)),
    }
    const frame = toOverlayFrame(result, false)
    expect(frame.keypoints[13]).toBeNull()
    expect(frame.keypoints[14]).not.toBeNull()
  })

  it("remaps verbose scorer joint keys to short overlay keys for quality and angles", () => {
    const result: PoseResult = {
      ...BASE,
      joint_scores: { left_knee_angle: 90, right_hip_angle: 72, hip_trunk_angle: 55 },
      measured_angles: { left_knee_angle: 97, right_hip_angle: 88 },
    }
    const frame = toOverlayFrame(result, false)
    expect(frame.jointQuality).toEqual({ lKnee: "good", rHip: "warn", spine: "error" })
    expect(frame.angles).toEqual({ lKnee: 97, rHip: 88 })
  })

  it("drops unmapped keys (e.g. shoulder angles) rather than throwing", () => {
    const result: PoseResult = {
      ...BASE,
      joint_scores: { left_shoulder_angle: 90 },
    }
    const frame = toOverlayFrame(result, false)
    expect(frame.jointQuality).toBeUndefined()
  })

  it("derives good/error state from the score using the 80 threshold", () => {
    expect(toOverlayFrame({ ...BASE, score: 80 }, false).state).toBe("good")
    expect(toOverlayFrame({ ...BASE, score: 79 }, false).state).toBe("error")
  })

  it("treats a non-ok status as idle regardless of score", () => {
    const result: PoseResult = { ...BASE, score: 95, status: "mismatch" }
    expect(toOverlayFrame(result, false).state).toBe("idle")
  })

  it("treats a missing status as ok (older servers)", () => {
    // BASE declares no `status` field at all — PoseResult.status is optional.
    expect(toOverlayFrame({ ...BASE, score: 95 }, false).state).toBe("good")
  })

  it("falls back to idle when status is ok but score is null", () => {
    const result: PoseResult = { ...BASE, score: null, status: "ok" }
    expect(toOverlayFrame(result, false).state).toBe("idle")
  })

  it("takes the first cue and passes mirrored through unchanged", () => {
    const frame = toOverlayFrame({ ...BASE, cues: ["First", "Second"] }, true)
    expect(frame.cue).toBe("First")
    expect(frame.mirrored).toBe(true)
  })
})
