import { memo, useCallback, useMemo, useState } from "react"
import { Search, X } from "lucide-react"

import type { ExerciseSummary } from "../types"
import { useExerciseCatalog } from "../hooks/useExerciseCatalog"
import { CustomExerciseSheet } from "./CustomExerciseSheet"
import { Icon } from "./ui/Icon"

interface ExercisePickerProps {
  readonly onPick: (ex: ExerciseSummary) => void
  readonly onClose: () => void
}

function ExercisePickerInner({ onPick, onClose }: ExercisePickerProps): JSX.Element {
  const { all, loading, search, addLocal } = useExerciseCatalog()
  const [query, setQuery] = useState("")
  const [showCustomSheet, setShowCustomSheet] = useState(false)

  const results = useMemo(() => search(query), [search, query])

  const handlePick = useCallback(
    (ex: ExerciseSummary): void => {
      onPick(ex)
      onClose()
    },
    [onPick, onClose],
  )

  const handleCustomCreated = useCallback(
    (ex: ExerciseSummary): void => {
      addLocal(ex)
      setShowCustomSheet(false)
      handlePick(ex)
    },
    [addLocal, handlePick],
  )

  if (showCustomSheet) {
    return (
      <CustomExerciseSheet
        onCreated={handleCustomCreated}
        onClose={() => setShowCustomSheet(false)}
      />
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Pick exercise"
      data-testid="exercise-picker"
    >
      <div
        className="flex max-h-[80vh] w-full flex-col rounded-t-2xl bg-surface-raised shadow-elev-3 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-white/5 px-4 py-3">
          <h3 className="flex-1 font-display text-base font-semibold text-gray-100">
            Add exercise
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close picker"
            className="grid h-11 w-11 place-content-center rounded-full text-gray-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            data-testid="exercise-picker-close"
          >
            <Icon icon={X} size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="shrink-0 px-3 py-2">
          <div className="relative">
            <Icon
              icon={Search}
              size={13}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              aria-label="Search exercises"
              autoFocus
              className="h-8 w-full rounded-full bg-surface-overlay pl-8 pr-3 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-3 pb-2">
          {loading && all.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">Loading…</p>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <p className="text-sm text-gray-500">No results.</p>
              <button
                type="button"
                onClick={() => setShowCustomSheet(true)}
                className="text-sm font-medium text-accent underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                data-testid="add-custom-exercise"
              >
                Can't find it? Add your own
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {results.slice(0, 80).map((ex) => (
                <button
                  key={ex.id}
                  type="button"
                  onClick={() => handlePick(ex)}
                  className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition hover:bg-surface-overlay focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  data-testid={`picker-row-${ex.slug}`}
                >
                  {ex.image_urls[0] && (
                    <img
                      src={ex.image_urls[0]}
                      alt=""
                      loading="lazy"
                      className="h-8 w-8 shrink-0 rounded-md object-cover"
                      aria-hidden="true"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-100">{ex.name}</p>
                    {ex.primary_muscles.length > 0 && (
                      <p className="truncate text-[11px] text-gray-500">
                        {ex.primary_muscles.join(", ")}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export const ExercisePicker = memo(ExercisePickerInner)
