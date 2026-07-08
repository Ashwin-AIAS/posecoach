import type { Exercise } from "../types"

/**
 * Catalog-slug → live CV exercise map (P26).
 *
 * Mirrors `scripts/seed_exercises.py::CV_EXERCISE_MAP`: the seed flags these
 * catalog rows `is_cv_supported` and their slugs are `slugify(source_id)` of
 * the free-exercise-db ids. If the seed map changes, change this with it
 * (the test pins all 17 entries).
 */
export const CV_SLUG_MAP: Readonly<Record<string, Exercise>> = {
  "barbell-squat": "squat",
  "barbell-deadlift": "deadlift",
  "barbell-curl": "curl",
  "barbell-bench-press-medium-grip": "bench",
  "standing-military-press": "ohp",
  "dumbbell-rear-lunge": "lunge",
  plank: "plank",
  pushups: "pushup",
  "hammer-curls": "hammer_curl",
  "side-lateral-raise": "lateral_raise",
  "bent-over-barbell-row": "barbell_row",
  "dumbbell-shoulder-press": "db_shoulder_press",
  "drag-curl": "drag_curl",
  "one-arm-dumbbell-row": "one_arm_row",
  "barbell-shrug": "shrug",
  "front-dumbbell-raise": "front_raise",
  "standing-dumbbell-triceps-extension": "overhead_triceps",
}

/** The live CV exercise for a catalog slug, or null when not form-checkable. */
export function cvExerciseForSlug(slug: string): Exercise | null {
  return CV_SLUG_MAP[slug] ?? null
}

/** The fields of a history-session row the form-check match cares about. */
export interface CvSessionCandidate {
  readonly id: string
  readonly exercise: string
  /** "exercise" or "posing"; absent on older servers → treat as exercise. */
  readonly session_type?: string
  readonly rep_count: number
  readonly avg_form_score: number
  readonly started_at: string
}

/** Client/server clocks drift — accept sessions up to this much "early". */
const CLOCK_SKEW_MS = 2 * 60 * 1000

/**
 * Find the CV session produced by a form-check: the newest *exercise* session
 * of the right exercise that started after the form-check was launched
 * (with a small clock-skew allowance — timestamps come from two clocks).
 * Returns null when nothing matches (anonymous set, wrong exercise, stale
 * list) — callers fail open to a plain set row.
 */
export function findFormCheckSession(
  sessions: readonly CvSessionCandidate[],
  cvExercise: Exercise,
  startedAfter: string,
): CvSessionCandidate | null {
  const cutoff = Date.parse(startedAfter) - CLOCK_SKEW_MS
  for (const s of sessions) {
    // Newest-first list — the first match is the one the user just did.
    if ((s.session_type ?? "exercise") !== "exercise") continue
    if (s.exercise !== cvExercise) continue
    if (Date.parse(s.started_at) < cutoff) continue
    return s
  }
  return null
}
