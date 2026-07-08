import { memo, useId, useState } from "react"
import { Check, Sparkles, Trash2 } from "lucide-react"

import type { LocalSet } from "../hooks/useWorkoutLog"
import type { SetHistoryEntry } from "../types"
import { oneRepMax } from "../lib/oneRepMax"
import { useUnitPref } from "../hooks/useUnitPref"
import { Icon } from "./ui/Icon"

const KG_PER_LB = 0.453592

/** Score → tone classes, mirroring the score-good/mid/bad palette. */
function scoreTone(score: number): string {
  if (score >= 80) return "bg-score-good/15 text-score-good"
  if (score >= 60) return "bg-score-mid/15 text-score-mid"
  return "bg-score-bad/15 text-score-bad"
}

interface SetRowProps {
  readonly setNumber: number
  readonly lastEntry?: SetHistoryEntry
  readonly onLog: (weightKg: number, reps: number, opts?: { rpe?: number }) => void
  readonly onComplete?: (setId: string, complete: boolean) => void
  readonly onRemove?: (setId: string) => void
  readonly committedSet?: LocalSet
  /** Pre-filled reps from a just-finished CV form-check (P26). */
  readonly cvPrefillReps?: number
}

function SetRowInner({
  setNumber,
  lastEntry,
  onLog,
  onComplete,
  onRemove,
  committedSet,
  cvPrefillReps,
}: SetRowProps): JSX.Element {
  const { unit } = useUnitPref()
  const toKg = (v: number): number => (unit === "lb" ? v * KG_PER_LB : v)
  const fromKg = (v: number): number => (unit === "lb" ? v / KG_PER_LB : v)

  const lastWeightDisplay = lastEntry ? Math.round(fromKg(lastEntry.weight_kg) * 10) / 10 : null
  const [weight, setWeight] = useState(lastWeightDisplay !== null ? String(lastWeightDisplay) : "")
  const [reps, setReps] = useState(
    cvPrefillReps !== undefined && cvPrefillReps > 0
      ? String(cvPrefillReps)
      : lastEntry
        ? String(lastEntry.reps)
        : "",
  )
  const [rpe, setRpe] = useState("")

  const weightId = useId()
  const repsId = useId()
  const rpeId = useId()

  const weightKg = toKg(Number(weight) || 0)
  const repsNum = Number(reps) || 0
  const estOrm = weight && reps ? oneRepMax(weightKg, repsNum) : null

  const handleLog = (): void => {
    if (!weight || !reps) return
    onLog(weightKg, repsNum, rpe ? { rpe: Number(rpe) } : undefined)
    setRpe("")
  }

  if (committedSet) {
    const wDisplay = Math.round(fromKg(committedSet.weight_kg) * 10) / 10
    const orm = oneRepMax(committedSet.weight_kg, committedSet.reps)
    return (
      <div
        className={
          "flex items-center gap-2 rounded-xl px-3 py-2.5 " +
          (committedSet.completed
            ? "bg-accent-soft/30"
            : "bg-surface-raised") +
          " shadow-elev-1"
        }
        data-testid={`set-row-committed-${committedSet.id}`}
      >
        <span className="w-5 shrink-0 text-center text-xs font-semibold text-gray-500">
          {committedSet.set_number || setNumber}
        </span>
        <span className="flex-1 text-sm text-gray-200">
          {wDisplay}
          {unit} × {committedSet.reps}
        </span>
        <span className="text-[11px] text-gray-500">
          e1RM {Math.round(fromKg(orm))}
          {unit}
        </span>
        {committedSet.form_score !== null && (
          <span
            className={`hud-numerals flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${scoreTone(committedSet.form_score)}`}
            title="Scored live by PoseCoach"
            data-testid={`form-badge-${committedSet.id}`}
          >
            <Icon icon={Sparkles} size={10} />
            {Math.round(committedSet.form_score)}
          </span>
        )}
        {committedSet.pending && (
          <span className="text-[11px] text-gray-500">saving…</span>
        )}
        {committedSet.error && (
          <span className="text-[11px] text-red-400">{committedSet.error}</span>
        )}
        {onComplete && (
          <button
            type="button"
            onClick={() => onComplete(committedSet.id, !committedSet.completed)}
            aria-label={committedSet.completed ? "Unmark set complete" : "Mark set complete"}
            className={
              "grid h-11 w-11 shrink-0 place-content-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
              (committedSet.completed
                ? "bg-accent text-surface-base"
                : "bg-surface-overlay text-gray-500 hover:text-white")
            }
            data-testid={`complete-toggle-${committedSet.id}`}
          >
            <Icon icon={Check} size={12} />
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={() => onRemove(committedSet.id)}
            aria-label="Remove set"
            className="grid h-11 w-11 shrink-0 place-content-center rounded-full text-gray-600 transition hover:text-red-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            data-testid={`remove-set-${committedSet.id}`}
          >
            <Icon icon={Trash2} size={12} />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface-raised p-3 shadow-elev-1" data-testid={`set-input-row-${setNumber}`}>
      <div className="flex items-center gap-1.5">
        <span className="w-5 shrink-0 text-center text-xs font-semibold text-gray-500">
          {setNumber}
        </span>

        <label htmlFor={weightId} className="sr-only">
          Weight in {unit}
        </label>
        <div className="relative flex-1">
          <input
            id={weightId}
            type="number"
            inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder={lastWeightDisplay !== null ? String(lastWeightDisplay) : "kg"}
            className="h-9 w-full rounded-lg bg-surface-overlay pr-7 pl-3 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={`Set ${setNumber} weight in ${unit}`}
            data-testid={`weight-input-${setNumber}`}
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-gray-500">
            {unit}
          </span>
        </div>

        <label htmlFor={repsId} className="sr-only">
          Reps for set {setNumber}
        </label>
        <div className="relative w-16">
          <input
            id={repsId}
            type="number"
            inputMode="numeric"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            placeholder="reps"
            className="h-9 w-full rounded-lg bg-surface-overlay px-3 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={`Set ${setNumber} reps`}
            data-testid={`reps-input-${setNumber}`}
          />
        </div>

        <label htmlFor={rpeId} className="sr-only">
          RPE for set {setNumber} (optional)
        </label>
        <div className="relative w-12">
          <input
            id={rpeId}
            type="number"
            inputMode="numeric"
            value={rpe}
            onChange={(e) => setRpe(e.target.value)}
            placeholder="RPE"
            min={1}
            max={10}
            className="h-9 w-full rounded-lg bg-surface-overlay px-2 text-xs text-gray-100 placeholder:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={`Set ${setNumber} RPE (optional, 1–10)`}
            data-testid={`rpe-input-${setNumber}`}
          />
        </div>

        <button
          type="button"
          onClick={handleLog}
          disabled={!weight || !reps}
          aria-label={`Log set ${setNumber}`}
          className="grid h-9 w-9 shrink-0 place-content-center rounded-full bg-accent text-surface-base shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] hover:brightness-110 disabled:translate-y-0 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid={`log-set-btn-${setNumber}`}
        >
          <Icon icon={Check} size={14} />
        </button>
      </div>

      <div className="flex gap-4 px-6">
        {cvPrefillReps !== undefined && cvPrefillReps > 0 && (
          <p className="flex items-center gap-1 text-[11px] font-medium text-accent" data-testid="cv-prefill-hint">
            <Icon icon={Sparkles} size={10} />
            Form-check counted {cvPrefillReps} reps
          </p>
        )}
        {lastEntry && (
          <p className="text-[11px] text-gray-500">
            Last: {lastWeightDisplay}
            {unit} × {lastEntry.reps}
          </p>
        )}
        {estOrm !== null && (
          <p className="text-[11px] text-gray-500">
            e1RM ≈ {Math.round(fromKg(estOrm))}
            {unit}
          </p>
        )}
      </div>
    </div>
  )
}

export const SetRow = memo(SetRowInner)
