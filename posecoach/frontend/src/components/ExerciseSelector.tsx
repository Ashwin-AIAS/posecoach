import { memo } from "react"

import type { Exercise } from "../types"
import { EXERCISES } from "../types"

interface ExerciseSelectorProps {
  readonly value: Exercise
  readonly onChange: (next: Exercise) => void
  readonly disabled?: boolean
}

function label(ex: Exercise): string {
  switch (ex) {
    case "ohp":
      return "OHP"
    default:
      return ex.charAt(0).toUpperCase() + ex.slice(1)
  }
}

function ExerciseSelectorInner({ value, onChange, disabled = false }: ExerciseSelectorProps): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Exercise">
      {EXERCISES.map((ex) => {
        const active = ex === value
        return (
          <button
            key={ex}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(ex)}
            className={
              "px-3 py-1 rounded text-sm font-medium transition " +
              (active
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-200 hover:bg-gray-600 disabled:opacity-50")
            }
          >
            {label(ex)}
          </button>
        )
      })}
    </div>
  )
}

export const ExerciseSelector = memo(ExerciseSelectorInner)
