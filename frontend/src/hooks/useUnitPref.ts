import { useCallback, useEffect, useState } from "react"

/** Weight-display unit preference. */
export type Unit = "kg" | "lb"

const STORAGE_KEY = "pc.units"
const DEFAULT_UNIT: Unit = "kg"

function isUnit(value: string | null): value is Unit {
  return value === "kg" || value === "lb"
}

function readStored(): Unit {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return isUnit(stored) ? stored : DEFAULT_UNIT
  } catch {
    return DEFAULT_UNIT
  }
}

interface UseUnitPrefResult {
  readonly unit: Unit
  readonly setUnit: (unit: Unit) => void
}

/**
 * Weight-unit preference (kg / lb) persisted in `localStorage` (key `pc.units`,
 * default `kg`). Units only — never store auth/JWT here; that rule is unchanged.
 * Client-side for now; the workout logger can migrate it server-side later for
 * cross-device sync (P24+).
 */
export function useUnitPref(): UseUnitPrefResult {
  const [unit, setUnitState] = useState<Unit>(readStored)

  const setUnit = useCallback((next: Unit): void => {
    setUnitState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // localStorage unavailable (private mode) — keep the in-memory value.
    }
  }, [])

  // Stay in sync if the preference changes in another tab or component instance.
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === STORAGE_KEY && isUnit(event.newValue)) {
        setUnitState(event.newValue)
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  return { unit, setUnit }
}
