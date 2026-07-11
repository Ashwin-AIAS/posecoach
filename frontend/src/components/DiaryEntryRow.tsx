import { memo } from "react"
import { Trash2 } from "lucide-react"

import type { LogEntryOut } from "../types"
import { fmt } from "../lib/macros"
import { Icon } from "./ui/Icon"

interface DiaryEntryRowProps {
  readonly entry: LogEntryOut
  readonly onEdit: (entry: LogEntryOut) => void
  readonly onDelete: (entry: LogEntryOut) => void
}

/**
 * One diary row (P28): food + amount on the left, kcal and a macro micro-line
 * on the right. The row itself opens the edit sheet; the trailing control
 * deletes (optimistically, with Undo — handled by DiaryDay).
 */
function DiaryEntryRowInner({ entry, onEdit, onDelete }: DiaryEntryRowProps): JSX.Element {
  return (
    <div className="flex items-center gap-1" data-testid={`entry-row-${entry.id}`}>
      <button
        type="button"
        onClick={() => onEdit(entry)}
        className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 rounded-xl px-2 py-2 text-left transition ease-spring hover:bg-white/5 active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
        data-testid={`entry-edit-${entry.id}`}
        aria-label={`Edit ${entry.food.name}`}
      >
        <span className="min-w-0">
          <span className="block truncate text-sm text-gray-100">{entry.food.name}</span>
          <span className="block truncate text-xs text-gray-500">
            {entry.food.brand ? `${entry.food.brand} · ` : ""}
            {fmt(entry.amount_g)} g
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="hud-numerals block text-sm text-gray-100">{fmt(entry.kcal)} kcal</span>
          <span className="block text-[11px] text-gray-500">
            P {fmt(entry.protein_g)} · C {fmt(entry.carbs_g)} · F {fmt(entry.fat_g)}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => onDelete(entry)}
        className="grid h-11 w-11 shrink-0 place-content-center rounded-full text-gray-500 transition ease-spring hover:text-red-400 active:scale-[0.95] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
        data-testid={`entry-delete-${entry.id}`}
        aria-label={`Delete ${entry.food.name}`}
      >
        <Icon icon={Trash2} size={16} />
      </button>
    </div>
  )
}

export const DiaryEntryRow = memo(DiaryEntryRowInner)
