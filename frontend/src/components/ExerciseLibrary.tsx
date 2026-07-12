import { memo, useCallback, useMemo, useState } from "react"
import { Search, Star } from "lucide-react"

import type { ExerciseSummary } from "../types"
import { useExerciseCatalog } from "../hooks/useExerciseCatalog"
import { ErrorRetry } from "./ErrorRetry"
import { SignInPrompt } from "./SignInPrompt"
import { Icon } from "./ui/Icon"

const MUSCLES = [
  "abdominals",
  "biceps",
  "chest",
  "glutes",
  "hamstrings",
  "lats",
  "lower back",
  "quadriceps",
  "shoulders",
  "triceps",
]

const EQUIPMENT = [
  "barbell",
  "body only",
  "cable",
  "dumbbell",
  "kettlebells",
  "machine",
]

interface ExerciseLibraryProps {
  readonly onSelect: (ex: ExerciseSummary) => void
  /** Deep-links to Settings when the catalog load 401s (P29). */
  readonly onSignIn?: () => void
}

interface FilterChipsProps {
  readonly label: string
  readonly options: readonly string[]
  readonly value: string
  readonly onChange: (v: string) => void
}

function FilterChips({ label, options, value, onChange }: FilterChipsProps): JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto py-0.5">
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.1em] text-gray-500">
        {label}
      </span>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(value === opt ? "" : opt)}
          aria-pressed={value === opt}
          className={
            "min-h-[44px] shrink-0 rounded-full px-2.5 text-xs font-medium transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
            (value === opt
              ? "bg-accent-soft text-accent"
              : "bg-surface-raised text-gray-400 shadow-elev-1 hover:text-white")
          }
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

function ExerciseRow({
  ex,
  onSelect,
}: {
  ex: ExerciseSummary
  onSelect: (ex: ExerciseSummary) => void
}): JSX.Element {
  const img = ex.image_urls[0] ?? null
  return (
    <button
      type="button"
      onClick={() => onSelect(ex)}
      className="flex min-h-[56px] w-full items-center gap-3 rounded-xl bg-surface-raised px-3 py-2.5 text-left shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      data-testid={`exercise-row-${ex.slug}`}
    >
      {img && (
        <img
          src={img}
          alt=""
          loading="lazy"
          className="h-10 w-10 shrink-0 rounded-lg object-cover"
          aria-hidden="true"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-gray-100">{ex.name}</span>
          {ex.is_cv_supported && (
            <Icon icon={Star} size={11} className="shrink-0 text-accent" />
          )}
        </div>
        {ex.primary_muscles.length > 0 && (
          <p className="truncate text-[11px] text-gray-500">{ex.primary_muscles.join(", ")}</p>
        )}
      </div>
      {ex.equipment && (
        <span className="shrink-0 text-[11px] text-gray-500">{ex.equipment}</span>
      )}
    </button>
  )
}

function ExerciseLibraryInner({ onSelect, onSignIn }: ExerciseLibraryProps): JSX.Element {
  const { all, loading, error, search, retry } = useExerciseCatalog()
  const [query, setQuery] = useState("")
  const [muscle, setMuscle] = useState("")
  const [equipment, setEquipment] = useState("")

  const results = useMemo(
    () => search(query, { muscle: muscle || undefined, equipment: equipment || undefined }),
    [search, query, muscle, equipment],
  )

  const clearFilters = useCallback((): void => {
    setQuery("")
    setMuscle("")
    setEquipment("")
  }, [])

  const hasFilters = query !== "" || muscle !== "" || equipment !== ""

  return (
    <div className="flex h-full flex-col gap-0" data-testid="exercise-library">
      {/* Search box */}
      <div className="shrink-0 border-b border-white/5 p-3">
        <div className="relative">
          <Icon
            icon={Search}
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search exercises…"
            aria-label="Search exercises"
            className="h-9 w-full rounded-full bg-surface-overlay pl-8 pr-3 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex shrink-0 flex-col gap-1 border-b border-white/5 px-3 py-2">
        <FilterChips label="Muscle" options={MUSCLES} value={muscle} onChange={setMuscle} />
        <FilterChips
          label="Equipment"
          options={EQUIPMENT}
          value={equipment}
          onChange={setEquipment}
        />
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="self-end text-[11px] text-gray-500 underline hover:text-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {loading && all.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-500">Loading catalog…</p>
        ) : all.length === 0 && error === "auth" ? (
          <SignInPrompt message="Sign in to browse the exercise library" onSignIn={onSignIn} />
        ) : all.length === 0 && error === "error" ? (
          <ErrorRetry message="Couldn't load the exercise catalog." onRetry={retry} />
        ) : results.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-500">No exercises found.</p>
        ) : (
          <div className="flex flex-col gap-2 p-3">
            <p className="text-[11px] text-gray-600">
              {results.length} exercise{results.length !== 1 ? "s" : ""}
            </p>
            {results.map((ex) => (
              <ExerciseRow key={ex.id} ex={ex} onSelect={onSelect} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export const ExerciseLibrary = memo(ExerciseLibraryInner)
