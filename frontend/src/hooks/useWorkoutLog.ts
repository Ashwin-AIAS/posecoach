import { useCallback, useRef, useState } from "react"

import { addSet, cvLink, updateSet, deleteSet } from "../lib/workoutsApi"
import type { WorkoutLog, LoggedExerciseOut, LoggedSetOut } from "../types"

const RETRY_DELAYS = [1000, 2000, 4000]

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let i = 0; i <= RETRY_DELAYS.length; i++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (i < RETRY_DELAYS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[i]))
      }
    }
  }
  throw lastError
}

/** Optimistic per-set state — extends the API type with a local pending flag. */
export interface LocalSet extends LoggedSetOut {
  /** True while the POST is in-flight or retrying. */
  pending: boolean
  /** POST error message, if any. */
  error: string | null
}

export interface LocalExercise extends Omit<LoggedExerciseOut, "sets"> {
  sets: LocalSet[]
}

export interface LocalWorkout extends Omit<WorkoutLog, "exercises"> {
  exercises: LocalExercise[]
}

export interface UseWorkoutLogResult {
  /** Current in-flight workout (null when no active session). */
  readonly workout: LocalWorkout | null
  /** Replace the whole workout (call after API create/load). */
  readonly setWorkout: (w: WorkoutLog | null) => void
  /**
   * Optimistically log a set: adds it immediately to local state and then
   * POSTs to the API (with retry). The row shows `pending=true` until settled.
   * With `linkSessionId`, the committed set is then CV-linked (P26): the
   * server copies the session's form score onto it — never on the temp id,
   * and a failed link degrades to a plain set (fail open).
   */
  readonly logSet: (
    loggedExerciseId: string,
    weightKg: number,
    reps: number,
    opts?: { rpe?: number; isWarmup?: boolean; linkSessionId?: string },
  ) => void
  /** Mark a set complete (optimistic patch). */
  readonly completeSet: (setId: string, complete: boolean) => void
  /** Remove a set (optimistic delete). */
  readonly removeSet: (setId: string) => void
}

function toLocal(w: WorkoutLog): LocalWorkout {
  return {
    ...w,
    exercises: w.exercises.map((le) => ({
      ...le,
      sets: le.sets.map((s) => ({ ...s, pending: false, error: null })),
    })),
  }
}

/** Stable temp id generator for optimistic rows (replaced by the real id on commit). */
let _tempId = 0
const tempId = (): string => `_tmp_${++_tempId}`

export function useWorkoutLog(): UseWorkoutLogResult {
  const [workout, setWorkoutState] = useState<LocalWorkout | null>(null)
  // Keep a ref so async retry closures can patch the latest state.
  const workoutRef = useRef<LocalWorkout | null>(null)

  const setWorkout = useCallback((w: WorkoutLog | null): void => {
    const local = w ? toLocal(w) : null
    workoutRef.current = local
    setWorkoutState(local)
  }, [])

  const patchSet = useCallback((setId: string, patch: Partial<LocalSet>): void => {
    setWorkoutState((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        exercises: prev.exercises.map((le) => ({
          ...le,
          sets: le.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)),
        })),
      }
    })
  }, [])

  const removeSetLocal = useCallback((setId: string): void => {
    setWorkoutState((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        exercises: prev.exercises.map((le) => ({
          ...le,
          sets: le.sets.filter((s) => s.id !== setId),
        })),
      }
    })
  }, [])

  const logSet = useCallback(
    (
      loggedExerciseId: string,
      weightKg: number,
      reps: number,
      opts: { rpe?: number; isWarmup?: boolean; linkSessionId?: string } = {},
    ): void => {
      const optimisticId = tempId()
      const optimistic: LocalSet = {
        id: optimisticId,
        set_number: 0,
        weight_kg: weightKg,
        reps,
        rpe: opts.rpe ?? null,
        is_warmup: opts.isWarmup ?? false,
        completed: true,
        form_score: null,
        source_session_id: null,
        pending: true,
        error: null,
      }

      // Add optimistic row immediately.
      setWorkoutState((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          exercises: prev.exercises.map((le) =>
            le.id === loggedExerciseId ? { ...le, sets: [...le.sets, optimistic] } : le,
          ),
        }
      })

      // POST with retry, then replace the temp row with the real server row.
      void withRetry(() =>
        addSet(loggedExerciseId, {
          weight_kg: weightKg,
          reps,
          rpe: opts.rpe,
          is_warmup: opts.isWarmup ?? false,
          completed: true,
        }),
      )
        .then((real) => {
          setWorkoutState((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              exercises: prev.exercises.map((le) => ({
                ...le,
                sets: le.sets.map((s) =>
                  s.id === optimisticId
                    ? { ...real, pending: false, error: null }
                    : s,
                ),
              })),
            }
          })
          // CV link runs on the committed id only — the endpoint copies the
          // form score server-side; a failed link leaves a plain set.
          if (opts.linkSessionId !== undefined) {
            void withRetry(() => cvLink(real.id, opts.linkSessionId ?? null))
              .then((linked) => {
                patchSet(real.id, {
                  form_score: linked.form_score,
                  source_session_id: linked.source_session_id,
                })
              })
              .catch(() => {
                /* fail open */
              })
          }
        })
        .catch((err: unknown) => {
          patchSet(optimisticId, {
            pending: false,
            error: (err as Error).message ?? "Failed to save",
          })
        })
    },
    [patchSet],
  )

  const completeSet = useCallback(
    (setId: string, complete: boolean): void => {
      patchSet(setId, { completed: complete, pending: true, error: null })
      void withRetry(() => updateSet(setId, { completed: complete }))
        .then((real) => {
          setWorkoutState((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              exercises: prev.exercises.map((le) => ({
                ...le,
                sets: le.sets.map((s) =>
                  s.id === setId ? { ...real, pending: false, error: null } : s,
                ),
              })),
            }
          })
        })
        .catch((err: unknown) => {
          patchSet(setId, { pending: false, error: (err as Error).message ?? "Failed to save" })
        })
    },
    [patchSet],
  )

  const removeSet = useCallback(
    (setId: string): void => {
      removeSetLocal(setId)
      void withRetry(() => deleteSet(setId)).catch(() => {
        /* best-effort delete; already removed from UI */
      })
    },
    [removeSetLocal],
  )

  return { workout, setWorkout, logSet, completeSet, removeSet }
}
