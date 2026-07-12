import { memo, useCallback, useEffect, useState } from "react"
import { Play, Repeat, Trash2 } from "lucide-react"

import type { RoutineOut, WorkoutLog } from "../types"
import { UnauthenticatedError, friendlyMessage } from "../lib/api"
import { deleteRoutine, listRoutines, startFromRoutine } from "../lib/workoutsApi"
import { ErrorRetry } from "./ErrorRetry"
import { SignInPrompt } from "./SignInPrompt"
import { Icon } from "./ui/Icon"

interface RoutineListProps {
  /** Bumped by the parent to force a re-fetch (e.g. after save-as-routine). */
  readonly refreshKey?: number
  /** Called with the freshly created workout when a routine is started. */
  readonly onStartWorkout: (workout: WorkoutLog) => void
  /** Deep-links to Settings when starting a routine 401s (P29). */
  readonly onSignIn?: () => void
}

interface StartError {
  readonly routineId: string
  readonly auth: boolean
  readonly message: string
}

/**
 * Landing-page section listing the user's routine templates ("Push Day"),
 * each with one-tap Start and delete. Self-fetching, like the recent-workouts
 * list it sits next to; empty state renders nothing (the section only appears
 * once the user has saved a routine).
 */
function RoutineListInner({
  refreshKey = 0,
  onStartWorkout,
  onSignIn,
}: RoutineListProps): JSX.Element | null {
  const [routines, setRoutines] = useState<readonly RoutineOut[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [startError, setStartError] = useState<StartError | null>(null)

  useEffect(() => {
    let cancelled = false
    void listRoutines()
      .then((rows) => {
        if (!cancelled) setRoutines(rows)
      })
      .catch(() => {
        /* unauthenticated or network error — section simply stays hidden */
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  const handleStart = useCallback(
    async (routine: RoutineOut): Promise<void> => {
      setBusyId(routine.id)
      setStartError(null)
      try {
        const workout = await startFromRoutine(routine.id)
        onStartWorkout(workout)
      } catch (e) {
        setStartError({
          routineId: routine.id,
          auth: e instanceof UnauthenticatedError,
          message: friendlyMessage(e),
        })
      } finally {
        setBusyId(null)
      }
    },
    [onStartWorkout],
  )

  const handleDelete = useCallback(async (id: string): Promise<void> => {
    setConfirmId(null)
    setRoutines((prev) => prev.filter((r) => r.id !== id))
    try {
      await deleteRoutine(id)
    } catch {
      // best-effort — already removed from the UI
    }
  }, [])

  if (routines.length === 0) return null

  return (
    <div className="flex flex-col gap-2 p-4 pt-0" data-testid="routine-list">
      <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
        Routines
      </h3>
      <div className="flex flex-col gap-2">
        {routines.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between gap-2 rounded-xl bg-surface-raised px-3 py-2 shadow-elev-1"
            data-testid={`routine-row-${r.id}`}
          >
            <div className="flex min-w-0 items-center gap-2">
              <Icon icon={Repeat} size={14} className="shrink-0 text-accent" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-200">{r.name}</p>
                <p className="text-[11px] text-gray-500">
                  {r.exercises.length} exercise{r.exercises.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {confirmId === r.id ? (
                <>
                  <button
                    type="button"
                    onClick={() => void handleDelete(r.id)}
                    className="flex min-h-11 items-center rounded-full bg-score-bad/15 px-3 text-xs font-semibold text-score-bad transition active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    data-testid={`routine-delete-confirm-${r.id}`}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(null)}
                    className="flex min-h-11 items-center rounded-full px-3 text-xs text-gray-400 transition active:scale-[0.97] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Keep
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmId(r.id)}
                    aria-label={`Delete routine ${r.name}`}
                    className="grid h-11 w-11 place-content-center rounded-full text-gray-500 transition active:scale-[0.97] hover:text-score-bad focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    data-testid={`routine-delete-${r.id}`}
                  >
                    <Icon icon={Trash2} size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleStart(r)}
                    disabled={busyId !== null}
                    className="flex min-h-11 items-center gap-1.5 rounded-full bg-accent-soft px-3.5 text-xs font-semibold text-accent transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] disabled:translate-y-0 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    data-testid={`routine-start-${r.id}`}
                  >
                    <Icon icon={Play} size={12} />
                    {busyId === r.id ? "Starting…" : "Start"}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {startError &&
        (startError.auth ? (
          <SignInPrompt message="Sign in to start a routine" onSignIn={onSignIn} />
        ) : (
          <ErrorRetry
            message={startError.message}
            onRetry={() => {
              const routine = routines.find((r) => r.id === startError.routineId)
              if (routine) void handleStart(routine)
            }}
          />
        ))}
    </div>
  )
}

export const RoutineList = memo(RoutineListInner)
