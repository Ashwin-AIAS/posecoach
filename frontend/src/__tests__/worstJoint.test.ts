import { describe, expect, it } from "vitest"

import { KP } from "../lib/skeleton"
import { worstJoint } from "../lib/joints"

describe("worstJoint", () => {
  it("returns the lowest-scoring joint with its key and vertex keypoint index", () => {
    const result = worstJoint(
      {
        left_knee_angle: 90,
        right_knee_angle: 40,
        left_hip_angle: 75,
        right_hip_angle: 88,
      },
      62,
    )
    expect(result).not.toBeNull()
    expect(result?.key).toBe("right_knee_angle")
    expect(result?.keypointIndex).toBe(KP.RIGHT_KNEE)
    expect(result?.bodyPart).toBe("right knee")
    expect(result?.score).toBe(40)
  })

  it("returns null when the overall score is good (no nagging)", () => {
    const result = worstJoint({ left_knee_angle: 70, right_knee_angle: 60 }, 85)
    expect(result).toBeNull()
  })

  it("returns null when the overall score is unavailable", () => {
    expect(worstJoint({ left_knee_angle: 50 }, null)).toBeNull()
  })

  it("returns null when there are no joint scores", () => {
    expect(worstJoint(undefined, 50)).toBeNull()
    expect(worstJoint({}, 50)).toBeNull()
  })

  it("maps hip_trunk_angle to the hip anchor labelled 'core'", () => {
    const result = worstJoint({ hip_trunk_angle: 30, left_hip_angle: 90 }, 60)
    expect(result?.key).toBe("hip_trunk_angle")
    expect(result?.keypointIndex).toBe(KP.LEFT_HIP)
    expect(result?.bodyPart).toBe("core")
  })

  it("ignores unknown joint keys", () => {
    const result = worstJoint({ unknown_angle: 1, left_elbow_angle: 50 }, 55)
    expect(result?.key).toBe("left_elbow_angle")
    expect(result?.keypointIndex).toBe(KP.LEFT_ELBOW)
  })
})
