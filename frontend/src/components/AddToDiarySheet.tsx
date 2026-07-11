import { memo, useState } from "react"
import { CalendarPlus, PencilLine } from "lucide-react"

import type { FoodItemOut, LogEntryOut, Meal } from "../types"
import { logFood, updateLogEntry } from "../lib/nutritionApi"
import { asMeal, fmt, MEAL_LABELS, MEALS, previewMacros } from "../lib/macros"
import { formatDayLabel } from "../lib/day"
import { Icon } from "./ui/Icon"

interface AddToDiarySheetProps {
  readonly food: FoodItemOut
  /** The diary day (`YYYY-MM-DD`) the entry is logged to — the viewed day. */
  readonly dateISO: string
  readonly defaultMeal?: Meal
  /** When set, the sheet edits this existing entry (PATCH) instead of logging. */
  readonly editEntry?: LogEntryOut
  readonly onLogged: (entry: LogEntryOut) => void
  readonly onCancel: () => void
}

// Matches the server bound (AMOUNT_G_MAX): one row is a meal, not a shopping trip.
const AMOUNT_G_MAX = 5000

const FIELD_CLS =
  "w-full min-h-11 rounded-xl bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
const CHIP_CLS =
  "flex min-h-11 items-center justify-center rounded-full px-3 text-xs font-medium transition ease-spring active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"

/**
 * Meal + amount collector for "Add to diary" (P28): live kcal/P/C/F preview
 * for the entered amount, logged to the currently-viewed diary day. With
 * `editEntry` it edits that row instead (PATCH — the server recomputes the
 * snapshot). The preview mirrors the server formula; the response is the truth.
 */
function AddToDiarySheetInner({
  food,
  dateISO,
  defaultMeal,
  editEntry,
  onLogged,
  onCancel,
}: AddToDiarySheetProps): JSX.Element {
  const [meal, setMeal] = useState<Meal>(
    editEntry ? asMeal(editEntry.meal) : (defaultMeal ?? "snack"),
  )
  const [amount, setAmount] = useState(
    editEntry ? String(editEntry.amount_g) : String(food.serving_size_g ?? 100),
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amountNum = Number(amount)
  const amountValid =
    amount.trim() !== "" && Number.isFinite(amountNum) && amountNum > 0 && amountNum <= AMOUNT_G_MAX
  const preview = amountValid ? previewMacros(food, amountNum) : null

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!amountValid || pending) return
    setPending(true)
    setError(null)
    try {
      const entry = editEntry
        ? await updateLogEntry(editEntry.id, { meal, amount_g: amountNum })
        : await logFood({
            food_item_id: food.id,
            logged_date: dateISO,
            meal,
            amount_g: amountNum,
          })
      onLogged(entry)
    } catch (err) {
      setError((err as Error).message)
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="rounded-2xl bg-surface-raised p-4 shadow-elev-2"
      data-testid="add-to-diary-sheet"
    >
      <h3 className="font-display text-base font-semibold text-gray-100">
        {editEntry ? "Edit entry" : "Add to diary"}
      </h3>
      <p className="mt-0.5 text-xs text-gray-500">
        {food.name} · {formatDayLabel(dateISO)}
      </p>

      <fieldset className="mt-4">
        <legend className="mb-1.5 block text-xs font-medium text-gray-500">Meal</legend>
        <div className="grid grid-cols-4 gap-2">
          {MEALS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMeal(m)}
              aria-pressed={meal === m}
              className={`${CHIP_CLS} ${
                meal === m ? "bg-accent font-semibold text-gray-950" : "bg-white/5 text-gray-300 hover:text-white"
              }`}
              data-testid={`meal-chip-${m}`}
            >
              {MEAL_LABELS[m]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-4">
        <label htmlFor="atd-amount" className="mb-1 block text-xs font-medium text-gray-500">
          Amount (g)
        </label>
        <input
          id="atd-amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="100"
          className={FIELD_CLS}
          data-testid="atd-amount"
        />
        {food.serving_size_g !== null && (
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setAmount(String(food.serving_size_g))}
              className={`${CHIP_CLS} bg-white/5 text-gray-300 hover:text-white`}
              data-testid="atd-serving-chip"
            >
              {food.serving_label ?? `1 serving (${fmt(food.serving_size_g)} g)`}
            </button>
            <button
              type="button"
              onClick={() => setAmount("100")}
              className={`${CHIP_CLS} bg-white/5 text-gray-300 hover:text-white`}
              data-testid="atd-100g-chip"
            >
              100 g
            </button>
          </div>
        )}
      </div>

      <div
        className="mt-4 flex items-baseline justify-between rounded-xl bg-white/5 px-3 py-2.5"
        data-testid="log-preview"
      >
        {preview ? (
          <>
            <span className="hud-numerals text-xl font-semibold text-accent">
              {fmt(preview.kcal)}
              <span className="ml-1 text-xs font-normal text-gray-500">kcal</span>
            </span>
            <span className="text-xs text-gray-400">
              P {fmt(preview.protein_g)} · C {fmt(preview.carbs_g)} · F {fmt(preview.fat_g)} g
            </span>
          </>
        ) : (
          <span className="text-xs text-gray-500">Enter an amount to see the macros.</span>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-red-400">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={!amountValid || pending}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-gray-950 transition ease-spring active:scale-[0.97] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
          data-testid="atd-submit"
        >
          <Icon icon={editEntry ? PencilLine : CalendarPlus} size={16} />
          {editEntry
            ? pending
              ? "Saving…"
              : "Save changes"
            : pending
              ? "Adding…"
              : "Add to diary"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-medium text-gray-300 shadow-elev-1 transition ease-spring hover:text-white active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
          data-testid="atd-cancel"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

export const AddToDiarySheet = memo(AddToDiarySheetInner)
