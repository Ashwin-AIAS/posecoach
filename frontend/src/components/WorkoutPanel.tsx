import { memo, useCallback, useEffect, useState } from "react"
import { BookOpen, ClipboardList, Plus } from "lucide-react"

import type { ExerciseSummary, ExerciseDetail, WorkoutSummary } from "../types"
import { createWorkout, listWorkouts, getExercise } from "../lib/workoutsApi"
import { ActiveWorkout } from "./ActiveWorkout"
import { ExerciseDetail as ExerciseDetailView } from "./ExerciseDetail"
import { ExerciseLibrary } from "./ExerciseLibrary"
import { Icon } from "./ui/Icon"
import { useWorkoutLog } from "../hooks/useWorkoutLog"

type SubView = "landing" | "library" | "exercise-detail" | "active-workout"

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

interface WorkoutPanelProps {
  readonly onActiveWorkout?: (active: boolean) => void
}

function WorkoutPanelInner({ onActiveWorkout }: WorkoutPanelProps): JSX.Element {
  const [subView, setSubView] = useState<SubView>("landing")
  const [recentWorkouts, setRecentWorkouts] = useState<WorkoutSummary[]>([])
  const [loadingRecent, setLoadingRecent] = useState(true)
  const [selectedExercise, setSelectedExercise] = useState<ExerciseDetail | null>(null)
  const [startingWorkout, setStartingWorkout] = useState(false)

  const workoutLog = useWorkoutLog()

  const loadRecent = useCallback(async (): Promise<void> => {
    setLoadingRecent(true)
    try {
      const rows = await listWorkouts()
      setRecentWorkouts(rows.slice(0, 5))
    } catch {
      // Unauthenticated or network error — silently show empty.
    } finally {
      setLoadingRecent(false)
    }
  }, [])

  useEffect(() => {
    void loadRecent()
  }, [loadRecent])

  const handleStartWorkout = async (): Promise<void> => {
    setStartingWorkout(true)
    try {
      const w = await createWorkout()
      workoutLog.setWorkout(w)
      setSubView("active-workout")
      onActiveWorkout?.(true)
    } catch {
      // Surface to user? For now silently fail — button re-enabled.
    } finally {
      setStartingWorkout(false)
    }
  }

  const handleExerciseSelect = async (ex: ExerciseSummary): Promise<void> => {
    try {
      const detail = await getExercise(ex.slug)
      setSelectedExercise(detail)
      setSubView("exercise-detail")
    } catch {
      // silently ignore
    }
  }

  const handleFinishWorkout = useCallback(async (): Promise<void> => {
    if (workoutLog.workout) {
      try {
        await import("../lib/workoutsApi").then(({ updateWorkout }) =>
          updateWorkout(workoutLog.workout!.id, {
            ended_at: new Date().toISOString(),
          }),
        )
      } catch {
        // best-effort
      }
    }
    workoutLog.setWorkout(null)
    setSubView("landing")
    onActiveWorkout?.(false)
    void loadRecent()
  }, [workoutLog, loadRecent, onActiveWorkout])

  if (subView === "active-workout" && workoutLog.workout) {
    return (
      <ActiveWorkout
        workout={workoutLog.workout}
        workoutLog={workoutLog}
        onFinish={() => void handleFinishWorkout()}
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

  if (subView === "library") {
    return (
      <div className="flex h-full flex-col overflow-hidden" data-testid="workout-panel">
        <div className="flex shrink-0 items-center gap-2 border-b border-white/5 px-4 py-3">
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
        <ExerciseLibrary onSelect={(ex) => void handleExerciseSelect(ex)} />
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
      <div className="shrink-0 border-b border-white/5 px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon icon={ClipboardList} size={18} className="text-accent" />
            <h2 className="font-display text-lg font-semibold text-gray-100">Workouts</h2>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="flex shrink-0 flex-col gap-3 p-4">
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
      </div>

      {/* Recent workouts */}
      <div className="flex flex-col gap-2 p-4 pt-0">
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
          Recent workouts
        </h3>
        {loadingRecent ? (
          <p className="text-sm text-gray-600">Loading…</p>
        ) : recentWorkouts.length === 0 ? (
          <p className="text-sm text-gray-600">No workouts logged yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {recentWorkouts.map((w) => (
              <div
                key={w.id}
                className="flex items-center justify-between rounded-xl bg-surface-raised px-3 py-3 shadow-elev-1"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-200">
                    {w.title ?? "Workout"}
                  </p>
                  <p className="text-[11px] text-gray-500">{formatDate(w.started_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export const WorkoutPanel = memo<WorkoutPanelProps>(WorkoutPanelInner)
