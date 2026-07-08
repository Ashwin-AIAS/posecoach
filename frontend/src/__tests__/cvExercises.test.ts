import { describe, expect, it } from "vitest"

import { CV_SLUG_MAP, cvExerciseForSlug, findFormCheckSession } from "../lib/cvExercises"
import type { CvSessionCandidate } from "../lib/cvExercises"
import { EXERCISES } from "../types"

describe("CV_SLUG_MAP", () => {
  it("covers all 17 seeded CV slugs (mirrors seed_exercises.CV_EXERCISE_MAP)", () => {
    expect(Object.keys(CV_SLUG_MAP)).toHaveLength(17)
    expect(CV_SLUG_MAP["barbell-squat"]).toBe("squat")
    expect(CV_SLUG_MAP["barbell-bench-press-medium-grip"]).toBe("bench")
    expect(CV_SLUG_MAP["standing-military-press"]).toBe("ohp")
    expect(CV_SLUG_MAP["one-arm-dumbbell-row"]).toBe("one_arm_row")
    expect(CV_SLUG_MAP["standing-dumbbell-triceps-extension"]).toBe("overhead_triceps")
  })

  it("maps every slug to a valid live Exercise", () => {
    for (const cv of Object.values(CV_SLUG_MAP)) {
      expect(EXERCISES).toContain(cv)
    }
  })

  it("returns null for a non-CV slug", () => {
    expect(cvExerciseForSlug("cable-fly")).toBeNull()
    expect(cvExerciseForSlug("barbell-squat")).toBe("squat")
  })
})

describe("findFormCheckSession", () => {
  const at = (minsAgo: number): string => new Date(Date.now() - minsAgo * 60_000).toISOString()

  const session = (over: Partial<CvSessionCandidate>): CvSessionCandidate => ({
    id: "sess-1",
    exercise: "squat",
    session_type: "exercise",
    rep_count: 8,
    avg_form_score: 87.5,
    started_at: at(1),
    ...over,
  })

  it("returns the newest matching session", () => {
    const sessions = [
      session({ id: "newest", started_at: at(1) }),
      session({ id: "older", started_at: at(5) }),
    ]
    expect(findFormCheckSession(sessions, "squat", at(10))?.id).toBe("newest")
  })

  it("skips posing sessions and other exercises", () => {
    const sessions = [
      session({ id: "pose", session_type: "posing" }),
      session({ id: "wrong", exercise: "deadlift" }),
      session({ id: "match" }),
    ]
    expect(findFormCheckSession(sessions, "squat", at(10))?.id).toBe("match")
  })

  it("rejects sessions that predate the launch (beyond clock skew)", () => {
    const sessions = [session({ id: "stale", started_at: at(30) })]
    expect(findFormCheckSession(sessions, "squat", at(10))).toBeNull()
  })

  it("tolerates small clock skew between client and server", () => {
    // Session started 1 minute "before" the launch — within the 2-minute allowance.
    const sessions = [session({ id: "skewed", started_at: at(11) })]
    expect(findFormCheckSession(sessions, "squat", at(10))?.id).toBe("skewed")
  })

  it("treats a missing session_type as an exercise session", () => {
    const sessions = [session({ id: "legacy", session_type: undefined })]
    expect(findFormCheckSession(sessions, "squat", at(10))?.id).toBe("legacy")
  })

  it("returns null on an empty list", () => {
    expect(findFormCheckSession([], "squat", at(10))).toBeNull()
  })
})
