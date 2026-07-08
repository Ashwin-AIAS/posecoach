import type { ExerciseHistoryOut, SetHistoryEntry } from "../types"

/**
 * Per-session progression math (P26) — pure and deterministic.
 *
 * The history endpoint returns every set flat (newest workout first); charts
 * want one point per training session. No backend analytics endpoint: at
 * current data volumes the grouping is trivial client-side.
 */

/** One training session's aggregates for an exercise. */
export interface SessionPoint {
  readonly workoutId: string
  /** ISO timestamp of the session (the workout's performed_at). */
  readonly date: string
  /** Best estimated 1RM (Epley) across the session's sets, kg. */
  readonly bestE1rm: number
  /** Total volume (Σ weight × reps) of the session's sets, kg. */
  readonly volumeKg: number
}

/** Group history entries by workout into chronological per-session points. */
export function sessionSeries(history: ExerciseHistoryOut): SessionPoint[] {
  const byWorkout = new Map<string, { date: string; bestE1rm: number; volumeKg: number }>()
  for (const e of history.entries) {
    const existing = byWorkout.get(e.workout_id)
    if (existing) {
      existing.bestE1rm = Math.max(existing.bestE1rm, e.est_one_rep_max)
      existing.volumeKg += e.weight_kg * e.reps
    } else {
      byWorkout.set(e.workout_id, {
        date: e.performed_at,
        bestE1rm: e.est_one_rep_max,
        volumeKg: e.weight_kg * e.reps,
      })
    }
  }
  return [...byWorkout.entries()]
    .map(([workoutId, v]) => ({ workoutId, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** The all-time PR set — the entry with the highest estimated 1RM, if any. */
export function personalRecord(history: ExerciseHistoryOut): SetHistoryEntry | null {
  let best: SetHistoryEntry | null = null
  for (const e of history.entries) {
    if (best === null || e.est_one_rep_max > best.est_one_rep_max) best = e
  }
  return best
}
