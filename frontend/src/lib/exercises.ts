import type { Exercise } from "../types"
import { EXERCISES } from "../types"

/**
 * Single source of truth for exercise presentation metadata.
 *
 * The scorer (app/analysis/form_scorer.py) owns the biomechanics; this file owns
 * everything the UI needs to render: human label, category grouping, target
 * muscles, difficulty, and a curated YouTube demo. Each `youtubeId` was hand-
 * verified against YouTube's oEmbed endpoint (real title, reputable channel,
 * embeddable) so the lite-embed how-to facade never injects a dead iframe.
 */

export type ExerciseCategory = "Push" | "Pull" | "Legs" | "Arms" | "Shoulders" | "Core"

export type Difficulty = "Beginner" | "Intermediate" | "Advanced"

export interface ExerciseMeta {
  readonly id: Exercise
  readonly label: string
  readonly category: ExerciseCategory
  readonly primaryMuscles: readonly string[]
  /** 11-char YouTube video id — curated form demo, verified embeddable. */
  readonly youtubeId: string
  readonly difficulty: Difficulty
}

/** Display order for category sections in the selector grid. */
export const EXERCISE_CATEGORIES: readonly ExerciseCategory[] = [
  "Legs",
  "Push",
  "Pull",
  "Shoulders",
  "Arms",
  "Core",
] as const

/**
 * Metadata keyed by exercise id. Typed as `Record<Exercise, ...>` so adding an
 * exercise to the `Exercise` union without adding metadata is a compile error.
 */
export const EXERCISE_META: Record<Exercise, ExerciseMeta> = {
  squat: {
    id: "squat",
    label: "Squat",
    category: "Legs",
    primaryMuscles: ["Quads", "Glutes", "Hamstrings"],
    youtubeId: "CWl0apMgshk",
    difficulty: "Intermediate",
  },
  deadlift: {
    id: "deadlift",
    label: "Deadlift",
    category: "Legs",
    primaryMuscles: ["Glutes", "Hamstrings", "Lower Back"],
    youtubeId: "wYREQkVtvEc",
    difficulty: "Advanced",
  },
  lunge: {
    id: "lunge",
    label: "Reverse Lunge",
    category: "Legs",
    primaryMuscles: ["Quads", "Glutes", "Hamstrings"],
    youtubeId: "RZKXLMxPF_I",
    difficulty: "Beginner",
  },
  bench: {
    id: "bench",
    label: "Bench Press",
    category: "Push",
    primaryMuscles: ["Chest", "Triceps", "Front Delts"],
    youtubeId: "rT7DgCr-3pg",
    difficulty: "Intermediate",
  },
  pushup: {
    id: "pushup",
    label: "Push-Up",
    category: "Push",
    primaryMuscles: ["Chest", "Triceps", "Front Delts"],
    youtubeId: "IODxDxX7oi4",
    difficulty: "Beginner",
  },
  diamond_pushup: {
    id: "diamond_pushup",
    label: "Diamond Push-Up",
    category: "Push",
    primaryMuscles: ["Triceps", "Chest"],
    youtubeId: "J0DnG1_S92I",
    difficulty: "Intermediate",
  },
  barbell_row: {
    id: "barbell_row",
    label: "Barbell Row",
    category: "Pull",
    primaryMuscles: ["Lats", "Rhomboids", "Biceps"],
    youtubeId: "rqTOAM8WoeM",
    difficulty: "Intermediate",
  },
  one_arm_row: {
    id: "one_arm_row",
    label: "One-Arm Row",
    category: "Pull",
    primaryMuscles: ["Lats", "Rhomboids", "Biceps"],
    youtubeId: "pYcpY20QaE8",
    difficulty: "Beginner",
  },
  ohp: {
    id: "ohp",
    label: "Overhead Press",
    category: "Shoulders",
    primaryMuscles: ["Front Delts", "Triceps"],
    youtubeId: "F3QY5vMz_6I",
    difficulty: "Intermediate",
  },
  db_shoulder_press: {
    id: "db_shoulder_press",
    label: "DB Shoulder Press",
    category: "Shoulders",
    primaryMuscles: ["Front Delts", "Triceps"],
    youtubeId: "fuQpuu--bMI",
    difficulty: "Beginner",
  },
  lateral_raise: {
    id: "lateral_raise",
    label: "Lateral Raise",
    category: "Shoulders",
    primaryMuscles: ["Side Delts"],
    youtubeId: "3VcKaXpzqRo",
    difficulty: "Beginner",
  },
  curl: {
    id: "curl",
    label: "Bicep Curl",
    category: "Arms",
    primaryMuscles: ["Biceps"],
    youtubeId: "ykJmrZ5v0Oo",
    difficulty: "Beginner",
  },
  hammer_curl: {
    id: "hammer_curl",
    label: "Hammer Curl",
    category: "Arms",
    primaryMuscles: ["Biceps", "Brachialis", "Forearms"],
    youtubeId: "BRVDS6HVR9Q",
    difficulty: "Beginner",
  },
  drag_curl: {
    id: "drag_curl",
    label: "Drag Curl",
    category: "Arms",
    primaryMuscles: ["Biceps"],
    youtubeId: "LMdNTHH6G8I",
    difficulty: "Intermediate",
  },
  plank: {
    id: "plank",
    label: "Plank",
    category: "Core",
    primaryMuscles: ["Abs", "Core", "Lower Back"],
    youtubeId: "gSDNblPRh1U",
    difficulty: "Beginner",
  },
}

/** All metadata in declaration order. */
export const EXERCISE_META_LIST: readonly ExerciseMeta[] = EXERCISES.map((id) => EXERCISE_META[id])

/** Metadata for one exercise (always defined — `Record` guarantees coverage). */
export function getExerciseMeta(id: Exercise): ExerciseMeta {
  return EXERCISE_META[id]
}

/** Human label for an exercise, used across the selector, HUD, and drawer. */
export function exerciseLabel(id: Exercise): string {
  return EXERCISE_META[id].label
}

/** Exercises grouped by category, in `EXERCISE_CATEGORIES` order. */
export function exercisesByCategory(): readonly { category: ExerciseCategory; items: readonly ExerciseMeta[] }[] {
  return EXERCISE_CATEGORIES.map((category) => ({
    category,
    items: EXERCISE_META_LIST.filter((meta) => meta.category === category),
  })).filter((group) => group.items.length > 0)
}
