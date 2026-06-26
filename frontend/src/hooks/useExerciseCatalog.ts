import { useCallback, useEffect, useRef, useState } from "react"

import { listExercises } from "../lib/workoutsApi"
import type { ExerciseSummary } from "../types"

const CACHE_KEY = "pc.catalog.v1"
const PAGE_SIZE = 200

export interface CatalogFilters {
  muscle?: string
  equipment?: string
}

export interface UseExerciseCatalogResult {
  readonly all: readonly ExerciseSummary[]
  readonly loading: boolean
  readonly search: (q: string, filters?: CatalogFilters) => readonly ExerciseSummary[]
}

function loadFromStorage(): ExerciseSummary[] | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as ExerciseSummary[]
  } catch {
    return null
  }
}

function saveToStorage(data: ExerciseSummary[]): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(data))
  } catch {
    // localStorage quota or private mode — silently skip; in-memory cache still works
  }
}

async function fetchAllPages(): Promise<ExerciseSummary[]> {
  const all: ExerciseSummary[] = []
  let offset = 0
  // Page through until a page returns fewer rows than the limit (last page).
  for (;;) {
    const page = await listExercises({ limit: PAGE_SIZE, offset })
    all.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return all
}

function matchesFilters(ex: ExerciseSummary, q: string, filters: CatalogFilters): boolean {
  if (q) {
    const term = q.toLowerCase()
    const inName = ex.name.toLowerCase().includes(term)
    const inSlug = ex.slug.includes(term)
    const inMuscle = ex.primary_muscles.some((m) => m.toLowerCase().includes(term))
    if (!inName && !inSlug && !inMuscle) return false
  }
  if (filters.muscle) {
    const target = filters.muscle.toLowerCase()
    const hit =
      ex.primary_muscles.some((m) => m.toLowerCase() === target) ||
      ex.secondary_muscles.some((m) => m.toLowerCase() === target)
    if (!hit) return false
  }
  if (filters.equipment) {
    if ((ex.equipment ?? "").toLowerCase() !== filters.equipment.toLowerCase()) return false
  }
  return true
}

/**
 * Loads the full exercise catalog once (paging through limit=200 pages), caches
 * it in localStorage under `pc.catalog.v1`, and exposes an instant client-side
 * `search(q, filters)` function with zero network latency on repeat opens.
 */
export function useExerciseCatalog(): UseExerciseCatalogResult {
  const [all, setAll] = useState<ExerciseSummary[]>(() => loadFromStorage() ?? [])
  const [loading, setLoading] = useState(true)
  const fetchedRef = useRef(false)

  useEffect(() => {
    // If we loaded from localStorage cache, we can still mark loading=false
    // immediately and silently refresh in the background.
    if (fetchedRef.current) return
    fetchedRef.current = true

    const cached = loadFromStorage()
    if (cached && cached.length > 0) {
      setAll(cached)
      setLoading(false)
      // Background refresh — update cache quietly without blocking UI.
      void fetchAllPages()
        .then((fresh) => {
          if (fresh.length > 0) {
            setAll(fresh)
            saveToStorage(fresh)
          }
        })
        .catch(() => {
          /* network error — keep cached version */
        })
      return
    }

    void fetchAllPages()
      .then((data) => {
        setAll(data)
        saveToStorage(data)
      })
      .catch(() => {
        /* silently show empty; error surfaced by WorkoutPanel's own fetch guard */
      })
      .finally(() => setLoading(false))
  }, [])

  const search = useCallback(
    (q: string, filters: CatalogFilters = {}): readonly ExerciseSummary[] => {
      const term = q.trim()
      if (!term && !filters.muscle && !filters.equipment) return all
      return all.filter((ex) => matchesFilters(ex, term, filters))
    },
    [all],
  )

  return { all, loading, search }
}
