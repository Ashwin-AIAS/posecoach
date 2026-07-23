import { memo, useCallback, useEffect, useRef, useState } from "react"
import { BookOpen, ClipboardList, Play, Plus } from "lucide-react"

import type { Exercise, ExerciseSummary, ExerciseDetail, WorkoutLog, WorkoutSummary } from "../types"
import { apiJson, friendlyMessage, isNetworkError, UnauthenticatedError } from "../lib/api"
import { createWorkout, createRoutine, getExercise, getWorkout, listWorkouts } from "../lib/workoutsApi"
import { findFormCheckSession } from "../lib/cvExercises"
import type { CvSessionCandidate } from "../lib/cvExercises"
import { ActiveWorkout } from "./ActiveWorkout"
import type { FormCheckResult } from "./ActiveWorkout"
import { ErrorRetry } from "./ErrorRetry"
import { ExerciseDetail as ExerciseDetailView } from "./ExerciseDetail"
import { ExerciseLibrary } from "./ExerciseLibrary"
import { RoutineList } from "./RoutineList"
import { SignInPrompt } from "./SignInPrompt"
import { WorkoutDetail } from "./WorkoutDetail"
import { Icon } from "./ui/Icon"
import { useWorkoutLog } from "../hooks/useWorkoutLog"

type SubView = "landing" | "library" | "exercise-detail" | "active-workout" | "workout-detail"

/** A form-check in flight: set by App when launching, consumed on return (P26). */
export interface PendingFormCheck {
  readonly loggedExerciseId: string
  readonly cvExercise: Exercise
  /** ISO timestamp of the launch — the session match must not predate it. */
  readonly startedAt: string
}

/**
 * The active workout's id, persisted so the session survives tab switches
 * (App unmounts this panel on the Coach tab) and accidental reloads. Only the
 * id is stored — the workout itself is re-fetched from the API on resume.
 */
const ACTIVE_KEY = "pc.activeWorkout.v1"

function readActiveId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}

function writeActiveId(id: string | null): void {
  try {
    if (id === null) window.localStorage.removeItem(ACTIVE_KEY)
    else window.localStorage.setItem(ACTIVE_KEY, id)
  } catch {
    // localStorage unavailable (private mode) — resume simply won't survive.
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

/** Snapshot taken at finish time so "Save as routine" outlives the cleared workout. */
interface RoutineDraft {
  readonly name: string
  readonly exerciseIds: readonly string[]
}

interface WorkoutPanelProps {
  readonly onActiveWorkout?: (active: boolean) => void
  /** Launch a live form-check (App switches to the Coach live flow). */
  readonly onFormCheck?: (loggedExerciseId: string, cvExercise: Exercise) => void
  /** A form-check the user just returned from — resolve it to a session. */
  readonly pendingFormCheck?: PendingFormCheck | null
  /** Called once the pending form-check has been resolved (match or not). */
  readonly onFormCheckHandled?: () => void
  /** Deep-links to Settings from a "Sign in" card (P29). */
  readonly onNavigateSettings?: () => void
}

/** A failed action on the landing/library screens: sign-in card vs retry. */
interface ActionError {
  readonly auth: boolean
  readonly message: string
  readonly retry: () => void
}

function WorkoutPanelInner({
  onActiveWorkout,
  onFormCheck,
  pendingFormCheck = null,
  onFormCheckHandled,
  onNavigateSettings,
}: WorkoutPanelProps): JSX.Element {
  const [subView, setSubView] = useState<SubView>("landing")
  const [recentWorkouts, setRecentWorkouts] = useState<WorkoutSummary[]>([])
  const [loadingRecent, setLoadingRecent] = useState(true)
  const [recentError, setRecentError] = useState<ActionError | null>(null)
  const [selectedExercise, setSelectedExercise] = useState<ExerciseDetail | null>(null)
  const [viewingWorkoutId, setViewingWorkoutId] = useState<string | null>(null)
  const [startingWorkout, setStartingWorkout] = useState(false)
  const [resumableId, setResumableId] = useState<string | null>(() => readActiveId())
  const [routineDraft, setRoutineDraft] = useState<RoutineDraft | null>(null)
  const [routinesRefresh, setRoutinesRefresh] = useState(0)
  const [formCheckResult, setFormCheckResult] = useState<FormCheckResult | null>(null)
  // Start/resume share one slot — only one of those two CTAs is ever mid-flight.
  const [landingError, setLandingError] = useState<ActionError | null>(null)
  const [libraryError, setLibraryError] = useState<ActionError | null>(null)
  // One resolution per launch — guards effect re-runs (deps change, StrictMode).
  const handledFormCheckRef = useRef<string | null>(null)

  const workoutLog = useWorkoutLog()

  const loadRecent = useCallback(async (): Promise<void> => {
    setLoadingRecent(true)
    setRecentError(null)
    try {
      const rows = await listWorkouts()
      setRecentWorkouts(rows.slice(0, 5))
    } catch (e) {
      setRecentError({
        auth: e instanceof UnauthenticatedError,
        message: friendlyMessage(e),
        retry: () => void loadRecent(),
      })
    } finally {
      setLoadingRecent(false)
    }
  }, [])

  useEffect(() => {
    void loadRecent()
  }, [loadRecent])

  const enterActiveWorkout = useCallback(
    (w: WorkoutLog): void => {
      workoutLog.setWorkout(w)
      writeActiveId(w.id)
      setResumableId(null)
      setSubView("active-workout")
      onActiveWorkout?.(true)
    },
    [workoutLog, onActiveWorkout],
  )

  // Returning from a form-check: re-enter the persisted workout (this panel
  // was unmounted while on the Coach tab) and resolve the launch to its CV
  // session via the history API. No match → resume without a prefill.
  useEffect(() => {
    if (pendingFormCheck === null) return
    if (handledFormCheckRef.current === pendingFormCheck.startedAt) return
    handledFormCheckRef.current = pendingFormCheck.startedAt

    void (async () => {
      if (workoutLog.workout === null) {
        const storedId = readActiveId()
        if (storedId !== null) {
          try {
            const w = await getWorkout(storedId)
            if (w.ended_at === null) enterActiveWorkout(w)
          } catch {
            // Deleted or unauthenticated — stay on the landing.
          }
        }
      }
      try {
        const sessions = await apiJson<CvSessionCandidate[]>(
          "/api/v1/history/sessions?limit=5",
        )
        const match = findFormCheckSession(
          sessions,
          pendingFormCheck.cvExercise,
          pendingFormCheck.startedAt,
        )
        if (match !== null) {
          setFormCheckResult({
            loggedExerciseId: pendingFormCheck.loggedExerciseId,
            sessionId: match.id,
            repCount: match.rep_count,
          })
        }
      } catch {
        // fail open — a plain set row
      }
      onFormCheckHandled?.()
    })()
  }, [pendingFormCheck, workoutLog.workout, enterActiveWorkout, onFormCheckHandled])

  const handleStartWorkout = async (): Promise<void> => {
    setStartingWorkout(true)
    setLandingError(null)
    try {
      const w = await createWorkout()
      enterActiveWorkout(w)
    } catch (e) {
      setLandingError({
        auth: e instanceof UnauthenticatedError,
        message: friendlyMessage(e),
        retry: () => void handleStartWorkout(),
      })
    } finally {
      setStartingWorkout(false)
    }
  }

  const handleResume = async (): Promise<void> => {
    const id = resumableId
    if (id === null) return
    setLandingError(null)
    try {
      const w = await getWorkout(id)
      if (w.ended_at !== null) {
        // Already finished elsewhere — nothing to resume.
        writeActiveId(null)
        setResumableId(null)
        return
      }
      enterActiveWorkout(w)
    } catch (e) {
      if (e instanceof UnauthenticatedError) {
        // The workout is still there once they sign in — keep the pointer.
        setLandingError({ auth: true, message: friendlyMessage(e), retry: () => void handleResume() })
        return
      }
      // A genuine network hiccup is retryable without losing the pointer.
      // Anything else (e.g. 404 — deleted elsewhere) means it's truly gone.
      if (isNetworkError(e)) {
        setLandingError({ auth: false, message: friendlyMessage(e), retry: () => void handleResume() })
        return
      }
      writeActiveId(null)
      setResumableId(null)
    }
  }

  const handleExerciseSelect = async (ex: ExerciseSummary): Promise<void> => {
    setLibraryError(null)
    try {
      const detail = await getExercise(ex.slug)
      setSelectedExercise(detail)
      setSubView("exercise-detail")
    } catch (e) {
      setLibraryError({
        auth: e instanceof UnauthenticatedError,
        message: friendlyMessage(e),
        retry: () => void handleExerciseSelect(ex),
      })
    }
  }

  const handleFinishWorkout = useCallback(async (): Promise<void> => {
    const finished = workoutLog.workout
    if (finished) {
      try {
        await import("../lib/workoutsApi").then(({ updateWorkout }) =>
          updateWorkout(finished.id, {
            ended_at: new Date().toISOString(),
          }),
        )
      } catch {
        // best-effort
      }
      // Offer "Save as routine" when the workout actually contained exercises.
      if (finished.exercises.length > 0) {
        setRoutineDraft({
          name: finished.title ?? "Workout",
          exerciseIds: finished.exercises.map((le) => le.exercise_id),
        })
      }
    }
    workoutLog.setWorkout(null)
    writeActiveId(null)
    setSubView("landing")
    onActiveWorkout?.(false)
    void loadRecent()
  }, [workoutLog, loadRecent, onActiveWorkout])

  // Minimize (P34): leave the active workout for the Workouts landing *without*
  // finishing it. The session stays in `workoutLog` + the localStorage pointer,
  // so "Resume workout" reappears; the tab bar unhides via onActiveWorkout(false).
  const handleMinimize = useCallback((): void => {
    const active = workoutLog.workout
    if (active !== null) setResumableId(active.id)
    setSubView("landing")
    onActiveWorkout?.(false)
  }, [workoutLog.workout, onActiveWorkout])

  const handleSaveRoutine = async (): Promise<void> => {
    if (routineDraft === null) return
    try {
      await createRoutine(routineDraft.name, [...routineDraft.exerciseIds])
      setRoutinesRefresh((k) => k + 1)
    } catch {
      // best-effort — dismiss either way
    }
    setRoutineDraft(null)
  }

  if (subView === "active-workout" && workoutLog.workout) {
    return (
      <ActiveWorkout
        workout={workoutLog.workout}
        workoutLog={workoutLog}
        onFinish={() => void handleFinishWorkout()}
        onMinimize={handleMinimize}
        onFormCheck={onFormCheck}
        formCheckResult={formCheckResult}
        onFormCheckConsumed={() => setFormCheckResult(null)}
      />
    )
  }

  if (subView === "exercise-detail" && selectedExercise) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <ExerciseDetailView
          exercise={selectedExercise}
          onBack={() => setSubView("library")}
        />
      </div>
    )
  }

  if (subView === "workout-detail" && viewingWorkoutId) {
    return (
      <WorkoutDetail
        workoutId={viewingWorkoutId}
        onBack={() => {
          setViewingWorkoutId(null)
          setSubView("landing")
        }}
      />
    )
  }

  if (subView === "library") {
    return (
      <div className="flex h-full flex-col overflow-hidden" data-testid="workout-panel">
        <div
          className="flex shrink-0 items-center gap-2 border-b border-white/5 px-4 py-3"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <button
            type="button"
            onClick={() => setSubView("landing")}
            aria-label="Back to workouts"
            className="text-sm text-gray-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            ← Workouts
          </button>
          <h2 className="font-display text-base font-semibold text-gray-100">Exercise Library</h2>
        </div>
        {libraryError &&
          (libraryError.auth ? (
            <SignInPrompt message="Sign in to view this exercise" onSignIn={onNavigateSettings} />
          ) : (
            <ErrorRetry message={libraryError.message} onRetry={libraryError.retry} />
          ))}
        <ExerciseLibrary
          onSelect={(ex) => void handleExerciseSelect(ex)}
          onSignIn={onNavigateSettings}
        />
      </div>
    )
  }

  // Landing view
  return (
    <div
      className="flex h-full flex-col overflow-y-auto"
      data-testid="workout-panel"
    >
      {/* Header */}
      <div
        className="shrink-0 border-b border-white/5 px-4 py-4"
        style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon icon={ClipboardList} size={18} className="text-accent" />
            <h2 className="font-display text-lg font-semibold text-gray-100">Workouts</h2>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="flex shrink-0 flex-col gap-3 p-4">
        {resumableId !== null && (
          <button
            type="button"
            onClick={() => void handleResume()}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-accent-soft text-sm font-semibold text-accent shadow-elev-2 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            data-testid="resume-workout-btn"
          >
            <Icon icon={Play} size={16} />
            Resume workout
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleStartWorkout()}
          disabled={startingWorkout}
          className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-accent text-sm font-semibold text-surface-base shadow-elev-2 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] hover:brightness-110 disabled:translate-y-0 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid="start-workout-cta"
        >
          <Icon icon={Plus} size={16} />
          {startingWorkout ? "Starting…" : "Start workout"}
        </button>

        <button
          type="button"
          onClick={() => setSubView("library")}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-surface-raised text-sm font-medium text-gray-300 shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid="browse-exercises-btn"
        >
          <Icon icon={BookOpen} size={15} />
          Browse exercises
        </button>

        {landingError &&
          (landingError.auth ? (
            <SignInPrompt message="Sign in to track workouts" onSignIn={onNavigateSettings} />
          ) : (
            <ErrorRetry message={landingError.message} onRetry={landingError.retry} />
          ))}
      </div>

      {/* Routines */}
      <RoutineList
        refreshKey={routinesRefresh}
        onStartWorkout={enterActiveWorkout}
        onSignIn={onNavigateSettings}
      />

      {/* Recent workouts */}
      <div className="flex flex-col gap-2 p-4 pt-0">
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
          Recent workouts
        </h3>
        {loadingRecent ? (
          <p className="text-sm text-gray-600">Loading…</p>
        ) : recentError ? (
          recentError.auth ? (
            <SignInPrompt message="Sign in to see your recent workouts" onSignIn={onNavigateSettings} />
          ) : (
            <ErrorRetry message={recentError.message} onRetry={recentError.retry} />
          )
        ) : recentWorkouts.length === 0 ? (
          <p className="text-sm text-gray-600">No workouts logged yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {recentWorkouts.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => {
                  setViewingWorkoutId(w.id)
                  setSubView("workout-detail")
                }}
                className="flex min-h-11 w-full items-center justify-between rounded-xl bg-surface-raised px-3 py-3 text-left shadow-elev-1 transition hover:bg-surface-overlay active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                data-testid={`recent-workout-${w.id}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-200">
                    {w.title ?? "Workout"}
                  </p>
                  <p className="text-[11px] text-gray-500">{formatDate(w.started_at)}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Save-as-routine prompt (after finishing a workout with exercises) */}
      {routineDraft !== null && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setRoutineDraft(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Save workout as routine"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-t-2xl bg-surface-raised p-4 shadow-elev-3 animate-scale-in"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            <h3 className="font-display text-base font-semibold text-gray-100">
              Save as routine?
            </h3>
            <p className="mt-1 text-sm text-gray-400">
              Keep "{routineDraft.name}" ({routineDraft.exerciseIds.length} exercise
              {routineDraft.exerciseIds.length !== 1 ? "s" : ""}) as a one-tap template.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => void handleSaveRoutine()}
                className="flex min-h-11 flex-1 items-center justify-center rounded-full bg-accent text-sm font-semibold text-surface-base transition ease-spring active:scale-[0.97] hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                data-testid="save-routine-btn"
              >
                Save routine
              </button>
              <button
                type="button"
                onClick={() => setRoutineDraft(null)}
                className="flex min-h-11 flex-1 items-center justify-center rounded-full bg-surface-base text-sm font-medium text-gray-300 shadow-elev-1 transition ease-spring active:scale-[0.97] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                data-testid="skip-routine-btn"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export const WorkoutPanel = memo<WorkoutPanelProps>(WorkoutPanelInner)
