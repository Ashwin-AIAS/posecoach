import { useEffect, useState } from "react"

import { fetchRecommendation } from "../lib/api"
import type { Exercise, Recommendation } from "../types"

/**
 * One-line adaptive-coach card (P16) — shown when the selected exercise has
 * enough history for a recommendation. Renders nothing on cold start (204),
 * when signed out, or while loading.
 */
export function RecommendationCard({ exercise }: { exercise: Exercise }): JSX.Element | null {
  const [rec, setRec] = useState<Recommendation | null>(null)

  useEffect(() => {
    let cancelled = false
    setRec(null)
    void fetchRecommendation(exercise).then((r) => {
      if (!cancelled) setRec(r)
    })
    return () => {
      cancelled = true
    }
  }, [exercise])

  if (rec === null) return null

  const delta = rec.rep_target_delta
  const deltaLabel =
    delta === 0 ? null : `${delta > 0 ? "+" : ""}${delta}${rec.exercise === "plank" ? "s" : " reps"}`

  return (
    <div
      className="flex items-center gap-2 border-b border-surface-hairline bg-surface-raised/50 px-4 py-2 text-xs text-gray-200"
      data-testid="recommendation-card"
    >
      <span className="font-semibold uppercase tracking-wide text-accent">Coach</span>
      <span className="truncate">{rec.message}</span>
      {deltaLabel !== null && (
        <span className="hud-numerals ml-auto shrink-0 rounded-full border border-surface-hairline bg-surface-overlay px-2 py-0.5 font-medium text-gray-300">
          {deltaLabel}
        </span>
      )}
    </div>
  )
}
