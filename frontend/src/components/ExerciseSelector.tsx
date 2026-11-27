import { ChevronDown, CircleHelp } from "lucide-react"
import { memo, useMemo, useState } from "react"
import { createPortal } from "react-dom"

import type { Exercise, SessionMode } from "../types"
import type { ExerciseMeta } from "../lib/exercises"
import { EXERCISE_META, exercisesByCategory } from "../lib/exercises"
import { ModeToggle } from "./ModeToggle"
import { Icon } from "./ui/Icon"

interface ExerciseSelectorProps {
  readonly value: Exercise
  readonly onChange: (next: Exercise) => void
  readonly onShowHowTo: (ex: Exercise) => void
  readonly disabled?: boolean
  readonly mode?: SessionMode
  readonly onModeChange?: (next: SessionMode) => void
}

const DIFFICULTY_DOT: Record<ExerciseMeta["difficulty"], string> = {
  Beginner: "bg-score-good",
  Intermediate: "bg-score-mid",
  Advanced: "bg-score-bad",
}

function matches(meta: ExerciseMeta, q: string): boolean {
  if (q === "") return true
  const hay = `${meta.label} ${meta.category} ${meta.primaryMuscles.join(" ")}`.toLowerCase()
  return hay.includes(q.toLowerCase())
}

function ExerciseCard({
  meta,
  active,
  disabled,
  onSelect,
  onShowHowTo,
}: {
  meta: ExerciseMeta
  active: boolean
  disabled: boolean
  onSelect: () => void
  onShowHowTo: () => void
}): JSX.Element {
  return (
    <div className="relative">
      <button
        type="button"
        role="radio"
        aria-checked={active}
        aria-label={meta.label}
        disabled={disabled}
        onClick={onSelect}
        className={
          "flex w-full flex-col gap-2 rounded-xl p-3 text-left transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:translate-y-0 " +
          (active
            ? "border border-accent bg-accent-soft shadow-glow-sm"
            : "bg-surface-overlay shadow-elev-1 disabled:opacity-50")
        }
      >
        <span
          className={
            "grid h-8 w-8 place-content-center rounded-lg font-display text-sm font-semibold " +
            (active ? "bg-accent text-surface-base" : "bg-surface-raised text-gray-300")
          }
          aria-hidden="true"
        >
          {meta.label.charAt(0)}
        </span>
        <span className="text-sm font-medium text-white">{meta.label}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <span className={`h-1.5 w-1.5 rounded-full ${DIFFICULTY_DOT[meta.difficulty]}`} aria-hidden="true" />
          {meta.difficulty}
        </span>
      </button>
      <button
        type="button"
        onClick={onShowHowTo}
        aria-label={`How to ${meta.label}`}
        className="absolute right-2 top-2 grid h-7 w-7 place-content-center rounded-full bg-surface-base/80 text-xs text-gray-400 shadow-elev-1 hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Icon icon={CircleHelp} size={14} />
      </button>
    </div>
  )
}

function ExerciseSelectorInner({
  value,
  onChange,
  onShowHowTo,
  disabled = false,
  mode = "exercise",
  onModeChange,
}: ExerciseSelectorProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const active = EXERCISE_META[value]
  const isPosing = mode === "posing"

  const groups = useMemo(
    () =>
      exercisesByCategory()
        .map((g) => ({ category: g.category, items: g.items.filter((m) => matches(m, query)) }))
        .filter((g) => g.items.length > 0),
    [query],
  )

  const select = (ex: Exercise): void => {
    onChange(ex)
    setOpen(false)
    setQuery("")
  }

  const handleModeChange = (next: SessionMode): void => {
    onModeChange?.(next)
    if (next === "posing") {
      setOpen(false)
    }
  }

  const sheet = (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/70 p-4 pt-16 backdrop-blur-sm"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Choose exercise"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[75vh] w-full max-w-[640px] overflow-y-auto rounded-2xl bg-surface-raised p-4 shadow-elev-3 animate-scale-in"
      >
        {onModeChange !== undefined && (
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-xs uppercase tracking-[0.18em] text-gray-500">Mode</span>
            <ModeToggle value={mode} onChange={handleModeChange} disabled={disabled} />
          </div>
        )}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search exercises…"
          aria-label="Search exercises"
          className="mb-3 w-full rounded-lg border border-surface-hairline bg-surface-base px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-accent"
          data-testid="exercise-search"
        />
        <div role="radiogroup" aria-label="Exercise" className="space-y-4">
          {groups.map((group) => (
            <div key={group.category}>
              <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-gray-500">
                {group.category}
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {group.items.map((meta) => (
                  <ExerciseCard
                    key={meta.id}
                    meta={meta}
                    active={meta.id === value}
                    disabled={disabled}
                    onSelect={() => select(meta.id)}
                    onShowHowTo={() => onShowHowTo(meta.id)}
                  />
                ))}
              </div>
            </div>
          ))}
          {groups.length === 0 && (
            <p className="py-6 text-center text-sm text-gray-500">No exercises match “{query}”.</p>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="true"
        className="flex min-h-11 max-w-full items-center gap-2 rounded-full bg-surface-raised/90 px-3.5 text-sm font-medium text-white shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] disabled:translate-y-0 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        data-testid="exercise-change-btn"
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${isPosing ? "bg-accent" : DIFFICULTY_DOT[active.difficulty]}`}
          aria-hidden="true"
        />
        <span className="truncate font-medium text-white" data-testid="exercise-current-label">
          {isPosing ? "Posing" : active.label}
        </span>
        {!isPosing && (
          <span className="hidden shrink-0 text-xs text-gray-400 sm:inline">· {active.category}</span>
        )}
        <Icon icon={ChevronDown} size={15} className="shrink-0 text-gray-400" />
      </button>

      {open && (typeof document !== "undefined" ? createPortal(sheet, document.body) : sheet)}
    </div>
  )
}

export const ExerciseSelector = memo(ExerciseSelectorInner)
