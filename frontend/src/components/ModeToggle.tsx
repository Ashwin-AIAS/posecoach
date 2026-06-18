import { memo } from "react"

import type { SessionMode } from "../types"

interface ModeToggleProps {
  readonly value: SessionMode
  readonly onChange: (next: SessionMode) => void
  readonly disabled?: boolean
}

const MODES: readonly { id: SessionMode; label: string }[] = [
  { id: "exercise", label: "Exercise" },
  { id: "posing", label: "Posing" },
]

/** Segmented control switching between rep-based exercise and held-pose modes (P15). */
function ModeToggleInner({ value, onChange, disabled = false }: ModeToggleProps): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label="Session mode"
      className="inline-flex rounded-full bg-surface-raised p-0.5 shadow-elev-1"
    >
      {MODES.map((m) => {
        const active = m.id === value
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(m.id)}
            className={
              "flex min-h-11 items-center justify-center rounded-full px-3 text-xs font-medium transition active:scale-95 disabled:opacity-50 " +
              (active ? "bg-accent text-surface-base" : "text-gray-400 hover:text-white")
            }
            data-testid={`mode-${m.id}`}
          >
            {m.label}
          </button>
        )
      })}
    </div>
  )
}

export const ModeToggle = memo(ModeToggleInner)
