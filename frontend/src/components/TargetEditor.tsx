import { memo, useState } from "react"

import type { NutritionGoalIn, NutritionGoalOut } from "../types"

interface TargetEditorProps {
  /** The current goal, if any — prefills the fields. */
  readonly goal: NutritionGoalOut | null
  /** Persists the targets; must REJECT on failure so the error can show. */
  readonly onSave: (body: NutritionGoalIn) => Promise<unknown>
  readonly onCancel: () => void
  /** Fired after a successful save — the panel returns to the diary. */
  readonly onSaved: () => void
}

const FIELD_CLS =
  "w-full min-h-11 rounded-xl bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
const LABEL_CLS = "mb-1 block text-xs font-medium text-gray-500"

/** Mirrors the server bounds in app/nutrition/schemas.py — typo rejection only. */
const KCAL_MAX = 20000
const MACRO_MAX = 1000

function toNumber(v: string): number | null {
  const n = Number(v)
  return v.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Sets the daily budget (P34.2): a kcal target plus optional macro targets.
 *
 * The number is the user's own — this form suggests nothing, computes nothing
 * from body metrics, and attaches no advice to whatever is typed. Bounds exist
 * only to catch typos before the server 422s.
 */
function TargetEditorInner({ goal, onSave, onCancel, onSaved }: TargetEditorProps): JSX.Element {
  const [kcal, setKcal] = useState(goal?.kcal_target != null ? String(goal.kcal_target) : "")
  const [protein, setProtein] = useState(
    goal?.protein_target_g != null ? String(goal.protein_target_g) : "",
  )
  const [carbs, setCarbs] = useState(goal?.carbs_target_g != null ? String(goal.carbs_target_g) : "")
  const [fat, setFat] = useState(goal?.fat_target_g != null ? String(goal.fat_target_g) : "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const kcalNum = toNumber(kcal)
  const inRange = (n: number | null, max: number): boolean => n === null || n <= max
  const canSave =
    kcalNum !== null &&
    kcalNum > 0 &&
    kcalNum <= KCAL_MAX &&
    inRange(toNumber(protein), MACRO_MAX) &&
    inRange(toNumber(carbs), MACRO_MAX) &&
    inRange(toNumber(fat), MACRO_MAX)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!canSave || kcalNum === null || saving) return
    setSaving(true)
    setError(null)
    try {
      const optional = (v: string): number | undefined => toNumber(v) ?? undefined
      await onSave({
        kcal_target: Math.round(kcalNum),
        protein_target_g: optional(protein),
        carbs_target_g: optional(carbs),
        fat_target_g: optional(fat),
      })
      onSaved()
    } catch (err) {
      // Never close on failure — the button stays, and it is the retry.
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="rounded-2xl bg-surface-raised p-4 shadow-elev-2"
      data-testid="target-editor"
    >
      <h3 className="font-display text-base font-semibold text-gray-100">Daily target</h3>
      <p className="mt-0.5 text-xs text-gray-500">
        Your own numbers — the diary just counts down from them.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label htmlFor="te-kcal" className={LABEL_CLS}>
            Calories (kcal / day)
          </label>
          <input
            id="te-kcal"
            value={kcal}
            onChange={(e) => setKcal(e.target.value)}
            inputMode="numeric"
            placeholder="e.g. 2400"
            className={FIELD_CLS}
            data-testid="te-kcal"
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              ["te-protein", "Protein (g)", protein, setProtein],
              ["te-carbs", "Carbs (g)", carbs, setCarbs],
              ["te-fat", "Fat (g)", fat, setFat],
            ] as const
          ).map(([id, label, value, setter]) => (
            <div key={id}>
              <label htmlFor={id} className={LABEL_CLS}>
                {label}
              </label>
              <input
                id={id}
                value={value}
                onChange={(e) => setter(e.target.value)}
                inputMode="decimal"
                placeholder="optional"
                className={FIELD_CLS}
                data-testid={id}
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          Leave a macro blank to skip tracking it. You can change these any time.
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-red-400" data-testid="te-error">
          Couldn&apos;t save — {error} Tap Save to try again.
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={!canSave || saving}
          className="flex min-h-11 flex-1 items-center justify-center rounded-full bg-accent px-4 text-sm font-semibold text-gray-950 transition ease-spring active:scale-[0.97] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
          data-testid="te-save"
        >
          {saving ? "Saving…" : "Save target"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-medium text-gray-300 shadow-elev-1 transition ease-spring active:scale-[0.97] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
          data-testid="te-cancel"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

export const TargetEditor = memo(TargetEditorInner)
