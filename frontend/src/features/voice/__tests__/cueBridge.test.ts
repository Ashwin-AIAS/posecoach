import { describe, expect, it, vi } from "vitest"

import {
  buildFaultCandidate,
  isNewRepBoundary,
  severityFromDeficit,
  sideOf,
  type CueFrame,
} from "../cueBridge"

describe("severityFromDeficit", () => {
  it("buckets a large deficit as high", () => {
    expect(severityFromDeficit(30)).toBe("high")
    expect(severityFromDeficit(60)).toBe("high")
  })

  it("buckets a mid-range deficit as medium", () => {
    expect(severityFromDeficit(15)).toBe("medium")
    expect(severityFromDeficit(29)).toBe("medium")
  })

  it("buckets a small deficit as low", () => {
    expect(severityFromDeficit(0)).toBe("low")
    expect(severityFromDeficit(14)).toBe("low")
  })
})

describe("sideOf", () => {
  it("extracts left/right from a prefixed joint name", () => {
    expect(sideOf("left_knee_angle")).toBe("left")
    expect(sideOf("right_shoulder_angle")).toBe("right")
  })

  it("returns null for a centre joint with no side prefix", () => {
    expect(sideOf("hip_trunk_angle")).toBeNull()
  })
})

describe("isNewRepBoundary", () => {
  it("is false on the very first frame (nothing to diff against)", () => {
    expect(isNewRepBoundary(1, null)).toBe(false)
  })

  it("is false when reps is absent (e.g. posing mode)", () => {
    expect(isNewRepBoundary(undefined, 3)).toBe(false)
  })

  it("is false when reps has not increased", () => {
    expect(isNewRepBoundary(3, 3)).toBe(false)
    expect(isNewRepBoundary(2, 3)).toBe(false)
  })

  it("is true exactly when reps increases", () => {
    expect(isNewRepBoundary(4, 3)).toBe(true)
  })
})

describe("buildFaultCandidate", () => {
  const resolve = vi.fn((exercise: string, cueText: string): string | null => {
    if (exercise === "squat" && cueText === "Squat deeper for full range") {
      return "squat.knee_angle.high"
    }
    return null
  })

  it("builds a side-expanded candidate from cues[0] + worst_joint", () => {
    const frame: CueFrame = {
      cues: ["Squat deeper for full range"],
      worst_joint: "left_knee_angle",
      joint_scores: { left_knee_angle: 60, right_knee_angle: 95 },
    }
    const built = buildFaultCandidate(frame, "squat", resolve)

    expect(built.lookupMiss).toBe(false)
    expect(built.cueText).toBe("Squat deeper for full range")
    expect(built.candidate).toEqual({ faultId: "squat.knee_angle.high.left", severity: "high" })
  })

  it("ignores cues[1] entirely (S8 decision: no side attribution, unreachable under the 1-cue cap)", () => {
    const frame: CueFrame = {
      cues: ["Squat deeper for full range", "Keep chest up and tall"],
      worst_joint: "left_knee_angle",
      joint_scores: { left_knee_angle: 60 },
    }
    const built = buildFaultCandidate(frame, "squat", resolve)
    expect(built.cueText).toBe("Squat deeper for full range")
  })

  it("reports a lookup miss (not a candidate) when the cue text has no S1 entry", () => {
    const frame: CueFrame = {
      cues: ["Some out-of-scope cue"],
      worst_joint: "left_knee_angle",
      joint_scores: { left_knee_angle: 60 },
    }
    const built = buildFaultCandidate(frame, "lunge", resolve)

    expect(built.candidate).toBeNull()
    expect(built.lookupMiss).toBe(true)
    expect(built.cueText).toBe("Some out-of-scope cue")
  })

  it("builds nothing when there is no cue this frame", () => {
    const frame: CueFrame = { cues: [], worst_joint: "left_knee_angle", joint_scores: {} }
    const built = buildFaultCandidate(frame, "squat", resolve)
    expect(built.candidate).toBeNull()
    expect(built.lookupMiss).toBe(false)
    expect(built.cueText).toBeNull()
  })

  it("builds nothing when worst_joint is missing", () => {
    const frame: CueFrame = { cues: ["Squat deeper for full range"], worst_joint: null, joint_scores: {} }
    const built = buildFaultCandidate(frame, "squat", resolve)
    expect(built.candidate).toBeNull()
    expect(built.lookupMiss).toBe(false)
  })

  it("treats a missing joint_scores entry for worst_joint as zero deficit", () => {
    const frame: CueFrame = {
      cues: ["Squat deeper for full range"],
      worst_joint: "left_knee_angle",
      joint_scores: {},
    }
    const built = buildFaultCandidate(frame, "squat", resolve)
    expect(built.candidate?.severity).toBe("low")
  })

  it("leaves a centre-joint (no side) fault id unexpanded", () => {
    const resolveStatus = (): string | null => "plank.hip_trunk_angle.low"
    const frame: CueFrame = {
      cues: ["Engage core to flatten back"],
      worst_joint: "hip_trunk_angle",
      joint_scores: { hip_trunk_angle: 70 },
    }
    const built = buildFaultCandidate(frame, "plank", resolveStatus)
    expect(built.candidate?.faultId).toBe("plank.hip_trunk_angle.low")
  })
})
