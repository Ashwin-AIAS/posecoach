export type Exercise =
  | "squat"
  | "deadlift"
  | "curl"
  | "bench"
  | "ohp"
  | "lunge"
  | "plank"
  | "pushup"
  | "hammer_curl"
  | "lateral_raise"
  | "barbell_row"
  | "db_shoulder_press"
  | "diamond_pushup"
  | "drag_curl"
  | "one_arm_row"
  | "shrug"
  | "front_raise"
  | "overhead_triceps"

export const EXERCISES: readonly Exercise[] = [
  "squat",
  "deadlift",
  "curl",
  "bench",
  "ohp",
  "lunge",
  "plank",
  "pushup",
  "hammer_curl",
  "lateral_raise",
  "barbell_row",
  "db_shoulder_press",
  "diamond_pushup",
  "drag_curl",
  "one_arm_row",
  "shrug",
  "front_raise",
  "overhead_triceps",
] as const

export type Keypoint = readonly [number, number]

/** Rep cycle phase from the backend rep counter. */
export type RepState = "up" | "down" | "hold"

/**
 * Why a frame looks the way it does. Only `ok` carries a meaningful `score`;
 * `no_person` means nobody was detected, `insufficient_confidence` means a
 * person is visible but the scored joints couldn't be measured reliably, and
 * `mismatch` means the movement doesn't match the chosen exercise (P13) so the
 * score is deliberately withheld rather than reported as good form.
 */
export type PoseStatus = "ok" | "no_person" | "insufficient_confidence" | "mismatch"

export interface PoseResult {
  readonly keypoints: readonly Keypoint[]
  readonly confidence: readonly number[]
  readonly score: number | null
  readonly cues: readonly string[]
  readonly latency_ms: number
  readonly hold_s?: number
  /** Running rep count for the active set (0 for isometric holds like plank). */
  readonly reps?: number
  /** Per-joint 0–100 form scores, keyed by joint angle name (e.g. "left_knee_angle"). */
  readonly joint_scores?: Readonly<Record<string, number>>
  /** Lowest-scoring joint angle key, or null when no joints were scored. */
  readonly worst_joint?: string | null
  /** Current rep cycle phase — drives trails, breathing, and particle bursts. */
  readonly rep_state?: RepState
  /** Raw measured angle (degrees) per scored joint — drives the overlay arcs. */
  readonly measured_angles?: Readonly<Record<string, number>>
  /** Why this frame looks the way it does. Absent on older servers → treat as "ok". */
  readonly status?: PoseStatus
  /** On a `mismatch`, the exercise the movement was checked against (for the banner). */
  readonly expected_exercise?: Exercise
}

export interface PoseError {
  readonly error: string
  readonly supported?: readonly string[]
}

export type ServerMessage = PoseResult | PoseError

export function isPoseError(msg: ServerMessage): msg is PoseError {
  return "error" in msg
}

export type ConnectionState = "idle" | "connecting" | "open" | "closed" | "error"

/** 1-tap post-set effort rating (P16): 1 = too easy, 3 = just right, 5 = too hard. */
export type EffortRating = 1 | 3 | 5

/** Next-session recommendation from the adaptive coach (P16). */
export interface Recommendation {
  readonly exercise: string
  /** Reps to add/remove vs last session (seconds for plank). */
  readonly rep_target_delta: number
  /** Worst-scoring joint key from the last session (e.g. "left_knee_angle"), if any. */
  readonly focus_joint: string | null
  /** One-line plain-English coaching message. */
  readonly message: string
}
