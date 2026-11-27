import { memo, useEffect, useState } from "react"
import { Award, ChevronLeft, Sparkles } from "lucide-react"

import type { LoggedSetOut, WorkoutLog } from "../types"
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

/** Score -> tone classes, mirroring the score-good/mid/bad palette. */
function scoreTone(score: number): string {
  if (score >= 80) return "bg-score-good/15 text-score-good"
  if (score >= 60) return "bg-score-mid/15 text-score-mid"
  return "bg-score-bad/15 text-score-bad"
}

/** Picks the top working set (by Epley estimated 1RM) to highlight per exercise. */
function pickBestSet(sets: readonly LoggedSetOut[]): LoggedSetOut | null {
  const candidates = sets.filter((s) => !s.is_warmup && s.reps > 0)
  const pool = candidates.length > 0 ? candidates : sets.filter((s) => s.reps > 0)
  if (pool.length === 0) return null
  let best = pool[0]
  let bestScore = best.weight_kg * (1 + best.reps / 30)
  for (let i = 1; i < pool.length; i++) {
    const score = pool[i].weight_kg * (1 + pool[i].reps / 30)
    if (score > bestScore) {
      best = pool[i]
      bestScore = score
    }
  }
  return best
}

/**
 * Read-only view of a past workout (polished per P36 B5 §0.4):
 * elevated cards without hairline borders, per-exercise best-set callout,
 * total volume, and a form-score badge on sets that were CV form-checked (P26).
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
      <div className="flex shrink-0 items-center gap-3 bg-surface-raised px-4 py-3 shadow-elev-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to workouts"
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-surface-overlay px-3.5 text-sm font-medium text-gray-200 shadow-elev-1 transition ease-spring hover:text-white active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Icon icon={ChevronLeft} size={16} />
          <span>Workouts</span>
        </button>
        <div className="min-w-0">
          <h2 className="truncate font-display text-base font-semibold text-gray-100">
            {workout?.title ?? "Workout"}
          </h2>
          {workout && (
            <p className="hud-numerals font-display text-xs text-gray-400">
              {formatDate(workout.started_at)} ·{" "}
              {Math.round(fromKg(totalVolumeKg)).toLocaleString()} {unit} total volume
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {failed && (
          <div className="rounded-2xl bg-surface-raised p-6 text-center shadow-elev-1">
            <p className="text-sm text-gray-400">Couldn't load this workout.</p>
          </div>
        )}
        {!failed && workout === null && (
          <p className="py-6 text-center text-sm text-gray-500">Loading…</p>
        )}
        {workout !== null && workout.exercises.length === 0 && (
          <div className="rounded-2xl bg-surface-raised p-6 text-center shadow-elev-1">
            <p className="text-sm text-gray-400">No exercises were logged.</p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {workout?.exercises.map((le) => {
            const topSet = pickBestSet(le.sets)
            return (
              <div key={le.id} className="rounded-2xl bg-surface-raised p-4 shadow-elev-1">
                <div className="mb-2.5 flex items-center justify-between gap-2">
                  <p className="font-display text-sm font-semibold text-white">
                    {le.exercise.name}
                  </p>
                  {topSet !== null && (
                    <span
                      className="hud-numerals inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 font-display text-[11px] font-semibold text-accent"
                      data-testid={`detail-exercise-best-${le.id}`}
                    >
                      <Icon icon={Award} size={11} />
                      Best {Math.round(fromKg(topSet.weight_kg) * 10) / 10} {unit} × {topSet.reps}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {le.sets.map((s, i) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between rounded-xl bg-surface-overlay px-3 py-2 text-sm shadow-elev-1"
                      data-testid={`detail-set-${s.id}`}
                    >
                      <span className="text-gray-400">
                        <span className="hud-numerals font-display text-xs text-gray-500">
                          {s.set_number || i + 1}
                        </span>
                        {"  "}
                        <span className="hud-numerals font-display font-medium text-gray-100">
                          {Math.round(fromKg(s.weight_kg) * 10) / 10} {unit} × {s.reps}
                        </span>
                        {s.is_warmup && (
                          <span className="ml-2 rounded-full bg-surface-raised px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-400">
                            warm-up
                          </span>
                        )}
                      </span>
                      {s.form_score !== null && (
                        <span
                          className={`hud-numerals flex items-center gap-1 rounded-full px-2.5 py-0.5 font-display text-xs font-semibold ${scoreTone(s.form_score)}`}
                          title="Scored live by PoseCoach"
                          data-testid={`detail-form-badge-${s.id}`}
                        >
                          <Icon icon={Sparkles} size={11} />
                          {Math.round(s.form_score)}
                        </span>
                      )}
                    </div>
                  ))}
                  {le.sets.length === 0 && (
                    <p className="text-xs text-gray-500">No sets logged.</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export const WorkoutDetail = memo(WorkoutDetailInner)
