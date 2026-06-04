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
] as const

export type Keypoint = readonly [number, number]

/** Rep cycle phase from the backend rep counter. */
export type RepState = "up" | "down" | "hold"

/**
 * Why a frame looks the way it does. Only `ok` carries a meaningful `score`;
 * `no_person` means nobody was detected and `insufficient_confidence` means a
 * person is visible but the scored joints couldn't be measured reliably. These
 * keep a "can't see you" frame distinct from genuinely poor form (P13).
 */
export type PoseStatus = "ok" | "no_person" | "insufficient_confidence"

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
