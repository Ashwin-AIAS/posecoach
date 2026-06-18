import { memo } from "react"

import { DIVISION_LIST } from "../lib/poses"
import type { Division } from "../types"

interface DivisionSelectorProps {
  readonly value: Division
  readonly onChange: (next: Division) => void
  readonly disabled?: boolean
}

/** Choose the competition division whose mandatory lineup is being rehearsed (P17). */
function DivisionSelectorInner({ value, onChange, disabled = false }: DivisionSelectorProps): JSX.Element {
  return (
    <label className="flex min-w-0 items-center gap-1.5 text-xs text-gray-400">
      <span className="sr-only">Division</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as Division)}
        aria-label="Division"
        className="min-w-0 max-w-[12rem] truncate rounded-full border border-surface-hairline bg-surface-raised px-3 py-1 text-xs font-medium text-gray-200 outline-none transition hover:border-accent/50 focus:border-accent disabled:opacity-50"
        data-testid="division-select"
      >
        {DIVISION_LIST.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export const DivisionSelector = memo(DivisionSelectorInner)
