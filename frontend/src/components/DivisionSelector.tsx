import { memo, useState } from "react"

import { CollapsibleSelect } from "./CollapsibleSelect"
import { DIVISION_LIST, getDivisionMeta } from "../lib/poses"
import type { Division } from "../types"

interface DivisionSelectorProps {
  readonly value: Division
  readonly onChange: (next: Division) => void
  readonly disabled?: boolean
}

/**
 * Choose the competition division/category whose mandatory lineup is being
 * rehearsed (P17). Its own collapsed chip on the selector row (P23) — the
 * category must be visible and reachable on its own, not buried inside the
 * pose sheet.
 */
function DivisionSelectorInner({ value, onChange, disabled = false }: DivisionSelectorProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const active = getDivisionMeta(value)

  const select = (id: Division): void => {
    onChange(id)
    setOpen(false)
  }

  return (
    <CollapsibleSelect
      open={open}
      onToggle={() => setOpen((o) => !o)}
      disabled={disabled}
      dialogLabel="Choose category"
      triggerAriaLabel="Change category"
      triggerTestId="division-change-btn"
      label={
        <span className="min-w-0 truncate text-sm font-medium text-white" data-testid="division-select">
          {active.label}
        </span>
      }
    >
      <div role="radiogroup" aria-label="Division" className="flex flex-wrap items-center gap-2">
        {DIVISION_LIST.map((d) => {
          const isActive = d.id === value
          return (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-label={d.label}
              disabled={disabled}
              onClick={() => select(d.id)}
              className={
                "flex min-h-11 items-center justify-center rounded-full px-3 text-xs font-medium transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] disabled:translate-y-0 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
                (isActive
                  ? "border border-accent bg-accent-soft text-accent"
                  : "bg-surface-raised text-gray-300 shadow-elev-1 hover:text-white")
              }
              data-testid={`division-${d.id}`}
            >
              {d.label}
            </button>
          )
        })}
      </div>
    </CollapsibleSelect>
  )
}

export const DivisionSelector = memo(DivisionSelectorInner)
