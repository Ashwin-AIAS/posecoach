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
