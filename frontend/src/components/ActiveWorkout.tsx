import { memo, useCallback, useEffect, useState } from "react"
import { ChevronDown, ChevronLeft, ChevronUp, Plus, Video } from "lucide-react"

import type { LocalWorkout, UseWorkoutLogResult } from "../hooks/useWorkoutLog"
import type { Exercise, ExerciseSummary, ExerciseHistoryOut } from "../types"
import { addExercise, getExerciseHistory } from "../lib/workoutsApi"
import { cvExerciseForSlug } from "../lib/cvExercises"
import { ExercisePicker } from "./ExercisePicker"
import { PlateCalculator } from "./PlateCalculator"
import { RestTimer } from "./RestTimer"
import { SetRow } from "./SetRow"
import { Icon } from "./ui/Icon"

/** A finished form-check waiting to land on the next logged set (P26). */
export interface FormCheckResult {
  readonly loggedExerciseId: string
  readonly sessionId: string
  readonly repCount: number
}

interface ActiveWorkoutProps {
  readonly workout: LocalWorkout
  readonly workoutLog: UseWorkoutLogResult
  readonly onFinish: () => void
  /**
   * Return to the Workouts landing *without finishing* — the session stays in
   * `workoutLog` + localStorage so "Resume workout" brings it back. Distinct
   * from `onFinish`, which ends the workout. Optional: no button when absent.
   */
  readonly onMinimize?: () => void
  /** Launch a live form-check for a CV-supported exercise (switches to Coach). */
  readonly onFormCheck?: (loggedExerciseId: string, cvExercise: Exercise) => void
  /** A just-finished form-check: pre-fills the target exercise's next set. */
  readonly formCheckResult?: FormCheckResult | null
  /** Called once the form-check result has been logged (or dismissed). */
  readonly onFormCheckConsumed?: () => void
}

function ActiveWorkoutInner({
  workout,
  workoutLog,
  onFinish,
  onMinimize,
  onFormCheck,
  formCheckResult = null,
  onFormCheckConsumed,
}: ActiveWorkoutProps): JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [expandedExercise, setExpandedExercise] = useState<string | null>(null)
  const [history, setHistory] = useState<Record<string, ExerciseHistoryOut>>({})
  const [timerKey, setTimerKey] = useState(0)
  const [autoStartTimer, setAutoStartTimer] = useState(false)
  const [showPlates, setShowPlates] = useState(false)

  // Load history for each exercise when first expanded.
  useEffect(() => {
    const slugs = workout.exercises.map((le) => le.exercise.slug)
    for (const slug of slugs) {
      if (history[slug]) continue
      void getExerciseHistory(slug)
        .then((h) => setHistory((prev) => ({ ...prev, [slug]: h })))
        .catch(() => {
          /* best-effort — history hint simply won't show */
        })
    }
  }, [workout.exercises, history])

  const handlePickExercise = useCallback(
    async (ex: ExerciseSummary): Promise<void> => {
      try {
        const le = await addExercise(workout.id, ex.id)
        // Reload the workout by setting it with the new exercise appended locally.
        workoutLog.setWorkout({
          ...workout,
          exercises: [...workout.exercises, le],
        })
        setExpandedExercise(le.id)
      } catch {
        // silently ignore — picker closes regardless
      }
    },
    [workout, workoutLog],
  )

  const handleLog = useCallback(
    (
      loggedExerciseId: string,
      weightKg: number,
      reps: number,
      opts?: { rpe?: number; linkSessionId?: string },
    ): void => {
      workoutLog.logSet(loggedExerciseId, weightKg, reps, opts)
      // Auto-start rest timer after each logged set.
      setTimerKey((k) => k + 1)
      setAutoStartTimer(true)
      setTimeout(() => setAutoStartTimer(false), 200)
    },
    [workoutLog],
  )

  const toggleExpanded = useCallback((id: string): void => {
    setExpandedExercise((prev) => (prev === id ? null : id))
  }, [])

  // A returning form-check opens its exercise so the pre-filled row is visible.
  useEffect(() => {
    if (formCheckResult !== null) setExpandedExercise(formCheckResult.loggedExerciseId)
  }, [formCheckResult])

  return (
    <div className="flex h-full flex-col" data-testid="active-workout">
      {/* Header */}
      <div
        className="flex shrink-0 items-center justify-between gap-2 border-b border-white/5 px-4 py-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {onMinimize && (
            <button
              type="button"
              onClick={onMinimize}
              aria-label="Back to workouts"
              title="Back to workouts — this workout keeps running"
              className="grid min-h-11 w-11 shrink-0 place-content-center rounded-full text-gray-400 transition ease-spring hover:bg-surface-overlay hover:text-white active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              data-testid="minimize-workout-btn"
            >
              <Icon icon={ChevronLeft} size={18} />
            </button>
          )}
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-gray-100">
              {workout.title ?? "Workout"}
            </h2>
            <p className="text-[11px] text-gray-500">
              {workout.exercises.length} exercise{workout.exercises.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onFinish}
          className="flex min-h-9 items-center rounded-full bg-accent px-4 text-xs font-semibold text-surface-base shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid="finish-workout-btn"
        >
          Finish
        </button>
      </div>

      {/* Exercises + sets */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-3">
          {workout.exercises.length === 0 && (
            <p className="py-4 text-center text-sm text-gray-500">
              Add your first exercise to get started.
            </p>
          )}

          {workout.exercises.map((le) => {
            const isExpanded = expandedExercise === le.id
            const hist = history[le.exercise.slug]
            const lastEntry = hist?.entries[0]
            const cvExercise = cvExerciseForSlug(le.exercise.slug)
            const pendingCheck =
              formCheckResult !== null && formCheckResult.loggedExerciseId === le.id
                ? formCheckResult
                : null

            return (
              <div key={le.id} className="rounded-2xl bg-surface-raised shadow-elev-1">
                {/* Exercise header row */}
                <button
                  type="button"
                  onClick={() => toggleExpanded(le.id)}
                  className="flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left transition hover:bg-surface-overlay focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-expanded={isExpanded}
                  data-testid={`exercise-section-${le.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-100">
                      {le.exercise.name}
                    </p>
                    <p className="text-[11px] text-gray-500">
                      {le.sets.length} set{le.sets.length !== 1 ? "s" : ""}
                      {lastEntry
                        ? ` · last: ${Math.round(lastEntry.weight_kg)}kg × ${lastEntry.reps}`
                        : ""}
                    </p>
                  </div>
                  <Icon
                    icon={isExpanded ? ChevronUp : ChevronDown}
                    size={14}
                    className="shrink-0 text-gray-500"
                  />
                </button>

                {isExpanded && (
                  <div className="flex flex-col gap-2 px-3 pb-3">
                    {/* Committed sets */}
                    {le.sets.map((s) => (
                      <SetRow
                        key={s.id}
                        setNumber={s.set_number || le.sets.indexOf(s) + 1}
                        committedSet={s}
                        onComplete={workoutLog.completeSet}
                        onRemove={workoutLog.removeSet}
                        onLog={() => {
                          /* no-op: committed rows don't call onLog */
                        }}
                      />
                    ))}

                    {/* New set input row — a returning form-check pre-fills the
                        CV rep count and links the session on log (P26). */}
                    <SetRow
                      key={pendingCheck !== null ? pendingCheck.sessionId : "plain"}
                      setNumber={le.sets.length + 1}
                      lastEntry={lastEntry}
                      cvPrefillReps={pendingCheck?.repCount}
                      onLog={(wKg, reps, opts) => {
                        handleLog(
                          le.id,
                          wKg,
                          reps,
                          pendingCheck !== null
                            ? { ...opts, linkSessionId: pendingCheck.sessionId }
                            : opts,
                        )
                        if (pendingCheck !== null) onFormCheckConsumed?.()
                      }}
                    />

                    {/* Live form-check launcher for CV-supported movements */}
                    {cvExercise !== null && onFormCheck && pendingCheck === null && (
                      <button
                        type="button"
                        onClick={() => onFormCheck(le.id, cvExercise)}
                        className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-dashed border-accent/40 text-xs font-medium text-accent transition hover:border-accent hover:bg-accent-soft/30 active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        data-testid={`form-check-btn-${le.id}`}
                        title="Do this set on camera — reps and form score land here"
                      >
                        <Icon icon={Video} size={13} />
                        Form-check this set
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* Add exercise button */}
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-700 text-sm font-medium text-gray-500 transition hover:border-gray-500 hover:text-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            data-testid="add-exercise-btn"
          >
            <Icon icon={Plus} size={14} />
            Add exercise
          </button>
        </div>

        {/* Rest timer */}
        <div className="mt-4 flex flex-col items-center">
          <RestTimer key={timerKey} autoStart={autoStartTimer} />
        </div>

        {/* Plate calculator */}
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowPlates((s) => !s)}
            className="text-xs text-gray-500 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {showPlates ? "Hide" : "Show"} plate calculator
          </button>
          {showPlates && (
            <div className="mt-2">
              <PlateCalculator />
            </div>
          )}
        </div>
      </div>

      {pickerOpen && (
        <ExercisePicker
          onPick={(ex) => void handlePickExercise(ex)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

export const ActiveWorkout = memo(ActiveWorkoutInner)
