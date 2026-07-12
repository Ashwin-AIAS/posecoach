import { memo, useState } from "react"
import type { FormEvent } from "react"
import { X } from "lucide-react"

import type { ExerciseSummary } from "../types"
import { UnauthenticatedError, friendlyMessage } from "../lib/api"
import { MUSCLES } from "../lib/muscleGroups"
import { createCustomExercise } from "../lib/workoutsApi"
import { SignInPrompt } from "./SignInPrompt"
import { Icon } from "./ui/Icon"

interface CustomExerciseSheetProps {
  readonly onCreated: (ex: ExerciseSummary) => void
  readonly onClose: () => void
}

/**
 * "Can't find it? Add your own" (P29) — a name (+ optional muscle group)
 * becomes a catalog row usable and loggable immediately, visible only to the
 * creator. Small bottom sheet, mirrors ExercisePicker's chrome.
 */
function CustomExerciseSheetInner({ onCreated, onClose }: CustomExerciseSheetProps): JSX.Element {
  const [name, setName] = useState("")
  const [muscle, setMuscle] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authRequired, setAuthRequired] = useState(false)

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setError(null)
    setAuthRequired(false)
    try {
      const ex = await createCustomExercise({
        name: trimmed,
        primaryMuscle: muscle || undefined,
      })
      onCreated(ex)
    } catch (err) {
      setAuthRequired(err instanceof UnauthenticatedError)
      setError(friendlyMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Add custom exercise"
      data-testid="custom-exercise-sheet"
    >
      <div
        className="flex w-full flex-col rounded-t-2xl bg-surface-raised shadow-elev-3 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-white/5 px-4 py-3">
          <h3 className="flex-1 font-display text-base font-semibold text-gray-100">
            Add custom exercise
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-11 w-11 place-content-center rounded-full text-gray-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Icon icon={X} size={16} />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3 px-4 py-4">
          <label className="flex flex-col gap-1.5 text-sm text-gray-300">
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Landmine Twist"
              autoFocus
              required
              maxLength={200}
              className="h-11 w-full rounded-xl bg-surface-overlay px-3 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm text-gray-300">
            Muscle group (optional)
            <select
              value={muscle}
              onChange={(e) => setMuscle(e.target.value)}
              className="h-11 w-full rounded-xl bg-surface-overlay px-3 text-sm text-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <option value="">None</option>
              {MUSCLES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          {authRequired ? (
            <SignInPrompt message="Sign in to add your own exercise" />
          ) : (
            error && (
              <p role="alert" className="text-xs text-red-400">
                {error}
              </p>
            )
          )}

          <button
            type="submit"
            disabled={!name.trim() || saving}
            className="mt-1 flex min-h-11 items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-gray-950 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
            data-testid="custom-exercise-submit"
          >
            {saving ? "Adding…" : "Add exercise"}
          </button>
        </form>
      </div>
    </div>
  )
}

export const CustomExerciseSheet = memo(CustomExerciseSheetInner)
