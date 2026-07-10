import { memo, useState } from "react"

import type { FoodItemOut } from "../types"
import { createManualFood } from "../lib/nutritionApi"

interface ManualFoodFormProps {
  /** The saved food — the panel switches to the macro card. */
  readonly onCreated: (food: FoodItemOut) => void
  readonly onCancel: () => void
}

const FIELD_CLS =
  "w-full min-h-11 rounded-xl bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
const LABEL_CLS = "mb-1 block text-xs font-medium text-gray-500"

/**
 * The "not found → type it in" fallback (P27): name + per-100 g macros, with
 * an optional serving size. Values are per 100 g to match the scanned cards.
 */
function ManualFoodFormInner({ onCreated, onCancel }: ManualFoodFormProps): JSX.Element {
  const [name, setName] = useState("")
  const [kcal, setKcal] = useState("")
  const [protein, setProtein] = useState("")
  const [carbs, setCarbs] = useState("")
  const [fat, setFat] = useState("")
  const [servingG, setServingG] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const kcalNum = Number(kcal)
  const canSave = name.trim().length > 0 && kcal.trim() !== "" && Number.isFinite(kcalNum) && kcalNum >= 0

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!canSave || saving) return
    setSaving(true)
    setError(null)
    try {
      const macro = (v: string): number | undefined => {
        const n = Number(v)
        return v.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : undefined
      }
      const serving = macro(servingG)
      const food = await createManualFood({
        name: name.trim(),
        kcal_100g: kcalNum,
        protein_100g: macro(protein),
        carbs_100g: macro(carbs),
        fat_100g: macro(fat),
        serving_size_g: serving && serving > 0 ? serving : undefined,
      })
      onCreated(food)
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="rounded-2xl bg-surface-raised p-4 shadow-elev-2"
      data-testid="manual-food-form"
    >
      <h3 className="font-display text-base font-semibold text-gray-100">Add a food manually</h3>
      <p className="mt-0.5 text-xs text-gray-500">Values are per 100 g, straight from the label.</p>

      <div className="mt-4 space-y-3">
        <div>
          <label htmlFor="mf-name" className={LABEL_CLS}>
            Name
          </label>
          <input
            id="mf-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Basmati rice (cooked)"
            maxLength={200}
            className={FIELD_CLS}
            data-testid="mf-name"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="mf-kcal" className={LABEL_CLS}>
              kcal / 100 g
            </label>
            <input
              id="mf-kcal"
              value={kcal}
              onChange={(e) => setKcal(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              className={FIELD_CLS}
              data-testid="mf-kcal"
            />
          </div>
          <div>
            <label htmlFor="mf-serving" className={LABEL_CLS}>
              Serving size (g, optional)
            </label>
            <input
              id="mf-serving"
              value={servingG}
              onChange={(e) => setServingG(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 150"
              className={FIELD_CLS}
              data-testid="mf-serving"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              ["mf-protein", "Protein (g)", protein, setProtein],
              ["mf-carbs", "Carbs (g)", carbs, setCarbs],
              ["mf-fat", "Fat (g)", fat, setFat],
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
                placeholder="0"
                className={FIELD_CLS}
                data-testid={id}
              />
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-red-400">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={!canSave || saving}
          className="flex min-h-11 flex-1 items-center justify-center rounded-full bg-accent px-4 text-sm font-semibold text-gray-950 transition ease-spring active:scale-[0.97] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
          data-testid="mf-save"
        >
          {saving ? "Saving…" : "Save food"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-medium text-gray-300 shadow-elev-1 transition ease-spring active:scale-[0.97] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
          data-testid="mf-cancel"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

export const ManualFoodForm = memo(ManualFoodFormInner)
