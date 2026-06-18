import { memo } from "react"

import { getPoseMeta } from "../lib/poses"
import type { PoseName } from "../types"

interface PoseSelectorProps {
  readonly value: PoseName
  readonly onChange: (next: PoseName) => void
  /** The mandatory poses to choose from (the active division's lineup, P17). */
  readonly poses: readonly PoseName[]
  readonly disabled?: boolean
}

/** Pick a mandatory pose to score from the active division's lineup (P17). */
function PoseSelectorInner({ value, onChange, poses, disabled = false }: PoseSelectorProps): JSX.Element {
  const active = getPoseMeta(value)
  return (
    <div className="flex flex-col gap-1.5">
      <div role="radiogroup" aria-label="Pose" className="flex flex-wrap items-center gap-2">
        {poses.map((id) => {
          const meta = getPoseMeta(id)
          const isActive = meta.id === value
          return (
            <button
              key={meta.id}
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-label={meta.label}
              disabled={disabled}
              onClick={() => onChange(meta.id)}
              className={
                "rounded-full px-3 py-1 text-xs font-medium transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] disabled:translate-y-0 disabled:opacity-50 " +
                (isActive
                  ? "border border-accent bg-accent-soft text-accent"
                  : "bg-surface-raised text-gray-300 shadow-elev-1 hover:text-white")
              }
              data-testid={`pose-${meta.id}`}
            >
              {meta.label}
            </button>
          )
        })}
      </div>
      <p className="text-[11px] text-gray-500">{active.hint}</p>
    </div>
  )
}

export const PoseSelector = memo(PoseSelectorInner)
