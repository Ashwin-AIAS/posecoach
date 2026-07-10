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

/** Session mode: rep-based exercise scoring vs. held-pose (bodybuilding) scoring (P15). */
export type SessionMode = "exercise" | "posing"

/** Bodybuilding poses scored in posing mode (P15 seed + P16 side + P17 full catalogue). */
export type PoseName =
  | "front_double_biceps"
  | "front_lat_spread"
  | "rear_double_biceps"
  | "side_chest"
  | "side_triceps"
  | "rear_lat_spread"
  | "abdominal_and_thigh"
  | "most_muscular"
  | "favorite_classic_pose"
  | "mp_front"
  | "mp_side"
  | "mp_back"
  | "qt_front"
  | "qt_back"
  | "figure_front"
  | "figure_back"

export const POSES: readonly PoseName[] = [
  "front_double_biceps",
  "front_lat_spread",
  "rear_double_biceps",
  "side_chest",
  "side_triceps",
  "rear_lat_spread",
  "abdominal_and_thigh",
  "most_muscular",
  "favorite_classic_pose",
  "mp_front",
  "mp_side",
  "mp_back",
  "qt_front",
  "qt_back",
  "figure_front",
  "figure_back",
] as const

/** Competition divisions, each with its own mandatory pose lineup (P17). */
export type Division =
  | "open"
  | "classic"
  | "mens_physique"
  | "bikini"
  | "wellness"
  | "figure"
  | "womens_physique"

/** Body orientation classified from keypoint geometry (posing mode). */
export type Orientation = "front" | "rear" | "side" | "unknown"

/** Live hold telemetry for a held pose: duration, steadiness, and a steady flag. */
export interface HoldInfo {
  readonly seconds: number
  readonly stability: number
  readonly steady: boolean
}

/** Rep cycle phase from the backend rep counter. */
export type RepState = "up" | "down" | "hold"

/**
 * Why a frame looks the way it does. Only `ok` carries a meaningful `score`;
 * `no_person` means nobody was detected, `insufficient_confidence` means a
 * person is visible but the scored joints couldn't be measured reliably, and
 * `mismatch` means the movement doesn't match the chosen exercise (P13) so the
 * score is deliberately withheld rather than reported as good form.
 */
export type PoseStatus =
  | "ok"
  | "no_person"
  | "insufficient_confidence"
  | "mismatch"
  | "wrong_orientation"
  | "unknown_pose"

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
  /** Posing mode (P15): left/right symmetry sub-score 0–100, or null when not scored. */
  readonly symmetry?: number | null
  /** Posing mode: live hold duration + steadiness telemetry. */
  readonly hold?: HoldInfo
  /** Posing mode: classified body orientation for the active frame. */
  readonly orientation?: Orientation
  /** Posing mode: per-check 0–100 scores keyed by parameter name. */
  readonly check_scores?: Readonly<Record<string, number>>
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

/** A contest-prep cycle: a named run-up to a show date grouping rehearsals (P17). */
export interface PrepCycle {
  readonly id: string
  readonly name: string
  readonly show_date: string | null
  readonly created_at: string
  /** Whole weeks until the show date (negative once past), null if no date set. */
  readonly weeks_out: number | null
}

/** One rehearsal's derived posing metrics on the progress timeline (P18). */
export interface PosePoint {
  readonly session_id: string
  readonly started_at: string
  /** Weeks before the show at the time of this rehearsal (null if no show date). */
  readonly weeks_out: number | null
  readonly avg_score: number | null
  /** Left/right symmetry 0–100, null in profile poses where it is meaningless. */
  readonly symmetry: number | null
  /** Keypoint steadiness 0–100, null when a session has too few snapshots. */
  readonly steadiness: number | null
}

/** Per-pose trend across a prep, plus the latest "fix this next" cue (P18). */
export interface PoseProgress {
  readonly pose: string
  readonly label: string
  readonly points: readonly PosePoint[]
  readonly focus_cue: string | null
}

/** A prep's full posing progress: every rehearsed pose trended over the cycle (P18). */
export interface PrepProgress {
  readonly prep_id: string
  readonly name: string
  readonly show_date: string | null
  readonly weeks_out: number | null
  readonly poses: readonly PoseProgress[]
}

// ── P25: Workout Logger types (additive — do not change anything above) ───────

/** Lightweight catalog row used in browse/search lists. */
export interface ExerciseSummary {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly category: string | null
  readonly equipment: string | null
  readonly primary_muscles: readonly string[]
  readonly secondary_muscles: readonly string[]
  /** Only first image URL (for list thumbnails); full list in ExerciseDetail. */
  readonly image_urls: readonly string[]
  readonly youtube_id: string | null
  readonly is_cv_supported: boolean
}

/** Full exercise detail (same shape as ExerciseSummary but explicit for type safety). */
export interface ExerciseDetail extends ExerciseSummary {
  readonly instructions: readonly string[]
}

/** One set's history entry returned from GET /exercises/:slug/history. */
export interface SetHistoryEntry {
  readonly workout_id: string
  readonly performed_at: string
  readonly weight_kg: number
  readonly reps: number
  readonly est_one_rep_max: number
}

/** Aggregate history for one exercise (volume + best 1RM + set list). */
export interface ExerciseHistoryOut {
  readonly slug: string
  readonly name: string
  readonly total_sets: number
  readonly total_volume_kg: number
  readonly best_one_rep_max: number
  readonly entries: readonly SetHistoryEntry[]
}

/** A logged set row (as returned by the API). */
export interface LoggedSetOut {
  readonly id: string
  readonly set_number: number
  readonly weight_kg: number
  readonly reps: number
  readonly rpe: number | null
  readonly is_warmup: boolean
  readonly completed: boolean
  readonly form_score: number | null
  readonly source_session_id: string | null
}

/** A logged exercise row (exercise reference + its sets). */
export interface LoggedExerciseOut {
  readonly id: string
  readonly exercise_id: string
  readonly order: number
  readonly exercise: ExerciseDetail
  readonly sets: readonly LoggedSetOut[]
}

/** Full workout with exercises eagerly loaded. */
export interface WorkoutLog {
  readonly id: string
  readonly title: string | null
  readonly notes: string | null
  readonly started_at: string
  readonly ended_at: string | null
  readonly exercises: readonly LoggedExerciseOut[]
}

/** Lightweight workout row for the recent-workouts list. */
export interface WorkoutSummary {
  readonly id: string
  readonly title: string | null
  readonly notes: string | null
  readonly started_at: string
  readonly ended_at: string | null
}

// ── P26: routines + CV linkage (additive — do not change anything above) ──────

/** One ordered exercise slot in a routine template. */
export interface RoutineExerciseOut {
  readonly exercise_id: string
  readonly order: number
  readonly exercise: ExerciseDetail
}

/** A reusable routine template ("Push Day"). */
export interface RoutineOut {
  readonly id: string
  readonly name: string
  readonly created_at: string
  readonly exercises: readonly RoutineExerciseOut[]
}

/** cv-link response: the updated set plus the session's CV rep count (null on detach). */
export interface CvLinkOut extends LoggedSetOut {
  readonly session_rep_count: number | null
}

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

// ── P27: nutrition (additive — do not change anything above) ─────────────────

/** A food product: an Open Food Facts cache row or the user's own manual entry. */
export interface FoodItemOut {
  readonly id: string
  readonly barcode: string | null
  readonly name: string
  readonly brand: string | null
  readonly serving_size_g: number | null
  readonly serving_label: string | null
  readonly kcal_100g: number
  readonly protein_100g: number
  readonly carbs_100g: number
  readonly fat_100g: number
  readonly image_url: string | null
  readonly source: string
}

// ── P28: diary (additive — mirrors app/nutrition/schemas.py exactly) ─────────

/** The four diary meals, in display order. */
export type Meal = "breakfast" | "lunch" | "dinner" | "snack"

/** One diary row with its food detail and log-time macro snapshot. */
export interface LogEntryOut {
  readonly id: string
  /** ISO `YYYY-MM-DD` — a date, never a timestamp. */
  readonly logged_date: string
  readonly meal: string
  readonly amount_g: number
  readonly kcal: number
  readonly protein_g: number
  readonly carbs_g: number
  readonly fat_g: number
  readonly food: FoodItemOut
}

/** Running totals for one diary day. */
export interface DailyTotals {
  readonly kcal: number
  readonly protein_g: number
  readonly carbs_g: number
  readonly fat_g: number
}

/** A full diary day: entries (insertion order) + server-computed totals. */
export interface DailyLogOut {
  readonly log_date: string
  readonly entries: readonly LogEntryOut[]
  readonly totals: DailyTotals
}
