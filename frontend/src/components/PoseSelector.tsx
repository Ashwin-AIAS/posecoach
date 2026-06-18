import { memo, useState, type ReactNode } from "react"

import { CollapsibleSelect } from "./CollapsibleSelect"
import { getPoseMeta } from "../lib/poses"
import type { PoseName } from "../types"

interface PoseSelectorProps {
  readonly value: PoseName
  readonly onChange: (next: PoseName) => void
  /** The mandatory poses to choose from (the active division's lineup, P17). */
  readonly poses: readonly PoseName[]
  readonly disabled?: boolean
  /** Extra control rendered above the pose grid inside the sheet (the DivisionSelector, P21) —
      kept out of the collapsed row so the row stays one compact line. */
  readonly extra?: ReactNode
}

/** Pick a mandatory pose to score from the active division's lineup (P17). */
function PoseSelectorInner({
  value,
  onChange,
  poses,
  disabled = false,
  extra,
}: PoseSelectorProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const active = getPoseMeta(value)

  const select = (id: PoseName): void => {
    onChange(id)
    setOpen(false)
  }

  return (
    <CollapsibleSelect
      open={open}
      onToggle={() => setOpen((o) => !o)}
      disabled={disabled}
      dialogLabel="Choose pose"
      triggerAriaLabel="Change pose"
      triggerTestId="pose-change-btn"
      label={
        <span className="min-w-0 truncate text-sm font-medium text-white" data-testid="pose-current-label">
          {active.label}
        </span>
      }
    >
      {extra && <div className="mb-3">{extra}</div>}
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
              onClick={() => select(meta.id)}
              className={
                "flex min-h-11 items-center justify-center rounded-full px-3 text-xs font-medium transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] disabled:translate-y-0 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
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
    </CollapsibleSelect>
  )
}

export const PoseSelector = memo(PoseSelectorInner)
