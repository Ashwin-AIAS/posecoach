import { useCallback, useEffect, useRef, useState } from "react"

import type { NutritionGoalIn, NutritionGoalOut } from "../types"
import { getGoal, putGoal } from "../lib/nutritionApi"

export interface UseNutritionGoal {
  /** The loaded goal, or `null` until it arrives (or if the load failed). */
  readonly goal: NutritionGoalOut | null
  readonly loading: boolean
  /**
   * Persist new targets. Resolves with the saved goal and updates `goal`;
   * REJECTS on failure so the editor can show an inline error + retry rather
   * than closing as if it had worked.
   */
  readonly save: (body: NutritionGoalIn) => Promise<NutritionGoalOut>
}

/**
 * Loads the caller's daily budget once and keeps it in sync after a save
 * (P34.2). A failed load is deliberately silent: the diary simply falls back to
 * plain totals with a "set a target" affordance — a budget the user has never
 * set is not an error worth an alert. A failed *save*, by contrast, always
 * surfaces (it rejects).
 */
export function useNutritionGoal(): UseNutritionGoal {
  const [goal, setGoal] = useState<NutritionGoalOut | null>(null)
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    void (async () => {
      try {
        const g = await getGoal()
        if (alive.current) setGoal(g)
      } catch {
        // Signed out or offline — fall back to the no-target state.
        if (alive.current) setGoal(null)
      } finally {
        if (alive.current) setLoading(false)
      }
    })()
    return () => {
      alive.current = false
    }
  }, [])

  const save = useCallback(async (body: NutritionGoalIn): Promise<NutritionGoalOut> => {
    const saved = await putGoal(body)
    if (alive.current) setGoal(saved)
    return saved
  }, [])

  return { goal, loading, save }
}
