import { memo, useEffect, useState } from "react"
import { Sparkles } from "lucide-react"

import type { WorkoutLog } from "../types"
import { getWorkout } from "../lib/workoutsApi"
import { useUnitPref } from "../hooks/useUnitPref"
import { Icon } from "./ui/Icon"

const KG_PER_LB = 0.453592

interface WorkoutDetailProps {
  readonly workoutId: string
  readonly onBack: () => void
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

/** Score → tone classes, mirroring the score-good/mid/bad palette. */
function scoreTone(score: number): string {
  if (score >= 80) return "bg-score-good/15 text-score-good"
  if (score >= 60) return "bg-score-mid/15 text-score-mid"
  return "bg-score-bad/15 text-score-bad"
}

/**
 * Read-only view of a past workout: every exercise with its sets, the total
 * volume, and a form-score badge on sets that were CV form-checked (P26).
 */
function WorkoutDetailInner({ workoutId, onBack }: WorkoutDetailProps): JSX.Element {
  const [workout, setWorkout] = useState<WorkoutLog | null>(null)
  const [failed, setFailed] = useState(false)
  const { unit } = useUnitPref()
  const fromKg = (v: number): number => (unit === "lb" ? v / KG_PER_LB : v)

  useEffect(() => {
    let cancelled = false
    void getWorkout(workoutId)
      .then((w) => {
        if (!cancelled) setWorkout(w)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [workoutId])

  const totalVolumeKg =
    workout?.exercises.reduce(
      (sum, le) => sum + le.sets.reduce((s, set) => s + set.weight_kg * set.reps, 0),
      0,
    ) ?? 0

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="workout-detail">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/5 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to workouts"
          className="flex min-h-11 items-center text-sm text-gray-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          ← Workouts
        </button>
        <div className="min-w-0">
          <h2 className="truncate font-display text-base font-semibold text-gray-100">
            {workout?.title ?? "Workout"}
          </h2>
          {workout && (
            <p className="text-[11px] text-gray-500">
              {formatDate(workout.started_at)} ·{" "}
              {Math.round(fromKg(totalVolumeKg)).toLocaleString()} {unit} total volume
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {failed && (
          <p className="py-4 text-center text-sm text-gray-500">Couldn't load this workout.</p>
        )}
        {!failed && workout === null && (
          <p className="py-4 text-center text-sm text-gray-600">Loading…</p>
        )}
        {workout !== null && workout.exercises.length === 0 && (
          <p className="py-4 text-center text-sm text-gray-500">No exercises were logged.</p>
        )}

        <div className="flex flex-col gap-3">
          {workout?.exercises.map((le) => (
            <div key={le.id} className="rounded-2xl bg-surface-raised p-3 shadow-elev-1">
              <p className="mb-2 text-sm font-medium text-gray-100">{le.exercise.name}</p>
              <div className="flex flex-col gap-1.5">
                {le.sets.map((s, i) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between text-sm"
                    data-testid={`detail-set-${s.id}`}
                  >
                    <span className="text-gray-400">
                      <span className="hud-numerals text-gray-500">{s.set_number || i + 1}</span>
                      {"  "}
                      <span className="hud-numerals text-gray-200">
                        {Math.round(fromKg(s.weight_kg) * 10) / 10} {unit} × {s.reps}
                      </span>
                      {s.is_warmup && <span className="ml-1.5 text-[11px] text-gray-600">warm-up</span>}
                    </span>
                    {s.form_score !== null && (
                      <span
                        className={`hud-numerals flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${scoreTone(s.form_score)}`}
                        title="Scored live by PoseCoach"
                        data-testid={`detail-form-badge-${s.id}`}
                      >
                        <Icon icon={Sparkles} size={10} />
                        {Math.round(s.form_score)}
                      </span>
                    )}
                  </div>
                ))}
                {le.sets.length === 0 && (
                  <p className="text-[11px] text-gray-600">No sets logged.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export const WorkoutDetail = memo(WorkoutDetailInner)
