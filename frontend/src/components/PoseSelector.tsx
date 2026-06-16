import { memo } from "react"

import { getPoseMeta, POSE_META_LIST } from "../lib/poses"
import type { PoseName } from "../types"

interface PoseSelectorProps {
  readonly value: PoseName
  readonly onChange: (next: PoseName) => void
  readonly disabled?: boolean
}

/** Pick the mandatory pose to score in posing mode (P15 seed set). */
function PoseSelectorInner({ value, onChange, disabled = false }: PoseSelectorProps): JSX.Element {
  const active = getPoseMeta(value)
  return (
    <div className="flex flex-col gap-1.5">
      <div role="radiogroup" aria-label="Pose" className="flex flex-wrap items-center gap-2">
        {POSE_META_LIST.map((meta) => {
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
                "rounded-full border px-3 py-1 text-xs font-medium transition disabled:opacity-50 " +
                (isActive
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-surface-hairline bg-surface-raised text-gray-300 hover:border-accent/50 hover:text-white")
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
