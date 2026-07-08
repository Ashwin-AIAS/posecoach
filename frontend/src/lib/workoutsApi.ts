/**
 * Typed wrappers for the P24 /api/v1/workouts endpoints.
 * Uses the same `apiFetch`/`apiJson` helpers as the rest of the app.
 */

import { apiJson } from "./api"
import type {
  CvLinkOut,
  ExerciseSummary,
  ExerciseDetail,
  ExerciseHistoryOut,
  RoutineOut,
  WorkoutLog,
  WorkoutSummary,
  LoggedExerciseOut,
  LoggedSetOut,
} from "../types"

// ── Catalog ───────────────────────────────────────────────────────────────────

export interface ListExercisesParams {
  search?: string
  muscle?: string
  equipment?: string
  limit?: number
  offset?: number
}

export async function listExercises(params: ListExercisesParams = {}): Promise<ExerciseSummary[]> {
  const q = new URLSearchParams()
  if (params.search) q.set("search", params.search)
  if (params.muscle) q.set("muscle", params.muscle)
  if (params.equipment) q.set("equipment", params.equipment)
  if (params.limit !== undefined) q.set("limit", String(params.limit))
  if (params.offset !== undefined) q.set("offset", String(params.offset))
  const qs = q.toString()
  return apiJson<ExerciseSummary[]>(`/api/v1/workouts/exercises${qs ? `?${qs}` : ""}`)
}

export async function getExercise(slug: string): Promise<ExerciseDetail> {
  return apiJson<ExerciseDetail>(`/api/v1/workouts/exercises/${encodeURIComponent(slug)}`)
}

export async function getExerciseHistory(slug: string): Promise<ExerciseHistoryOut> {
  return apiJson<ExerciseHistoryOut>(
    `/api/v1/workouts/exercises/${encodeURIComponent(slug)}/history`,
  )
}

// ── Workouts ──────────────────────────────────────────────────────────────────

export interface ListWorkoutsParams {
  from?: string
  to?: string
}

export async function listWorkouts(params: ListWorkoutsParams = {}): Promise<WorkoutSummary[]> {
  const q = new URLSearchParams()
  if (params.from) q.set("from", params.from)
  if (params.to) q.set("to", params.to)
  const qs = q.toString()
  return apiJson<WorkoutSummary[]>(`/api/v1/workouts/workouts${qs ? `?${qs}` : ""}`)
}

export async function createWorkout(title?: string): Promise<WorkoutLog> {
  // The API requires a non-empty title (WorkoutCreate min_length=1) — a null
  // title 422s, so default it client-side.
  return apiJson<WorkoutLog>("/api/v1/workouts/workouts", {
    method: "POST",
    body: JSON.stringify({ title: title ?? "Workout" }),
  })
}

export async function getWorkout(id: string): Promise<WorkoutLog> {
  return apiJson<WorkoutLog>(`/api/v1/workouts/workouts/${id}`)
}

export async function updateWorkout(
  id: string,
  patch: { title?: string; notes?: string; ended_at?: string },
): Promise<WorkoutLog> {
  return apiJson<WorkoutLog>(`/api/v1/workouts/workouts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

export async function deleteWorkout(id: string): Promise<void> {
  await apiJson<unknown>(`/api/v1/workouts/workouts/${id}`, { method: "DELETE" })
}

export async function addExercise(workoutId: string, exerciseId: string): Promise<LoggedExerciseOut> {
  return apiJson<LoggedExerciseOut>(`/api/v1/workouts/workouts/${workoutId}/exercises`, {
    method: "POST",
    body: JSON.stringify({ exercise_id: exerciseId }),
  })
}

// ── Sets ──────────────────────────────────────────────────────────────────────

export interface SetBody {
  weight_kg: number
  reps: number
  rpe?: number
  is_warmup?: boolean
  completed?: boolean
  set_number?: number
}

export async function addSet(loggedExerciseId: string, body: SetBody): Promise<LoggedSetOut> {
  return apiJson<LoggedSetOut>(`/api/v1/workouts/logged-exercises/${loggedExerciseId}/sets`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export async function updateSet(id: string, body: Partial<SetBody>): Promise<LoggedSetOut> {
  return apiJson<LoggedSetOut>(`/api/v1/workouts/sets/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
}

export async function deleteSet(id: string): Promise<void> {
  await apiJson<unknown>(`/api/v1/workouts/sets/${id}`, { method: "DELETE" })
}

/**
 * Attach a live CV session to a set (or detach with `sessionId: null`).
 * The form score is copied server-side from the session — never sent here.
 */
export async function cvLink(setId: string, sessionId: string | null): Promise<CvLinkOut> {
  return apiJson<CvLinkOut>(`/api/v1/workouts/sets/${setId}/cv-link`, {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId }),
  })
}

// ── Routines ──────────────────────────────────────────────────────────────────

export async function listRoutines(): Promise<RoutineOut[]> {
  return apiJson<RoutineOut[]>("/api/v1/workouts/routines")
}

export async function createRoutine(name: string, exerciseIds: string[]): Promise<RoutineOut> {
  return apiJson<RoutineOut>("/api/v1/workouts/routines", {
    method: "POST",
    body: JSON.stringify({ name, exercise_ids: exerciseIds }),
  })
}

export async function deleteRoutine(id: string): Promise<void> {
  await apiJson<unknown>(`/api/v1/workouts/routines/${id}`, { method: "DELETE" })
}

/** Start a new workout pre-populated with a routine's exercises. */
export async function startFromRoutine(routineId: string): Promise<WorkoutLog> {
  return apiJson<WorkoutLog>(`/api/v1/workouts/workouts/from-routine/${routineId}`, {
    method: "POST",
  })
}
