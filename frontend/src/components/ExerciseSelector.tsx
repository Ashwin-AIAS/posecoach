import { memo, useMemo, useState } from "react"

import type { Exercise } from "../types"
import type { ExerciseMeta } from "../lib/exercises"
import { EXERCISE_META, exercisesByCategory } from "../lib/exercises"

interface ExerciseSelectorProps {
  readonly value: Exercise
  readonly onChange: (next: Exercise) => void
  readonly onShowHowTo: (ex: Exercise) => void
  readonly disabled?: boolean
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
          "flex w-full flex-col gap-2 rounded-xl border p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
          (active
            ? "border-accent bg-accent-soft shadow-glow-sm"
            : "border-surface-hairline bg-surface-overlay hover:border-accent/50 disabled:opacity-50")
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
        className="absolute right-2 top-2 grid h-6 w-6 place-content-center rounded-full border border-surface-hairline bg-surface-base/80 text-xs text-gray-400 hover:border-accent hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        ?
      </button>
    </div>
  )
}

function ExerciseSelectorInner({
  value,
  onChange,
  onShowHowTo,
  disabled = false,
}: ExerciseSelectorProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const active = EXERCISE_META[value]

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

  return (
    <div className="relative">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-2 text-sm">
          <span className={`h-2 w-2 rounded-full ${DIFFICULTY_DOT[active.difficulty]}`} aria-hidden="true" />
          <span className="font-medium text-white">{active.label}</span>
          <span className="text-gray-500">· {active.category}</span>
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="true"
          className="rounded-full border border-surface-hairline bg-surface-raised px-3 py-1 text-xs font-medium text-gray-300 transition hover:border-accent/50 hover:text-white disabled:opacity-50"
          data-testid="exercise-change-btn"
        >
          Change ▾
        </button>
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute left-0 top-full z-40 mt-2 max-h-[70vh] w-[min(92vw,640px)] overflow-y-auto rounded-2xl border border-surface-hairline bg-surface-raised p-4 shadow-card animate-scale-in">
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
        </>
      )}
    </div>
  )
}

export const ExerciseSelector = memo(ExerciseSelectorInner)
