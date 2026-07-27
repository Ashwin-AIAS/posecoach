/**
 * Pure daily-budget math (P34.2): what's left of a target, and a rough
 * activity-equivalent for a surplus.
 *
 * Health-values note that governs this whole file: the activity equivalent is
 * *context*, never a prescription. Nothing here computes a "deficit to make
 * up", nothing frames movement as compensation, and the caller only renders it
 * when the user explicitly asks to see it.
 */

/** Target vs consumed for one nutrient on one day. */
export interface Remaining {
  readonly target: number
  readonly consumed: number
  /** Positive = still available; negative = over the target. */
  readonly remaining: number
  readonly over: boolean
}

/**
 * `target − consumed`, or `null` when no target is tracked for this nutrient
 * (the caller then falls back to plain totals). A target of exactly 0 is still
 * a target — only null/undefined means "not tracked".
 */
export function remainingOf(
  target: number | null | undefined,
  consumed: number,
): Remaining | null {
  if (target === null || target === undefined || !Number.isFinite(target)) return null
  const remaining = round1(target - consumed)
  return { target, consumed: round1(consumed), remaining, over: remaining < 0 }
}

/** Fraction of the target consumed, clamped to 0–1 — for the progress bar. */
export function progressFraction(r: Remaining): number {
  if (r.target <= 0) return r.consumed > 0 ? 1 : 0
  return Math.min(1, Math.max(0, r.consumed / r.target))
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// ── Activity equivalent (opt-in context only) ────────────────────────────────

/**
 * A reference body weight, in kg, for the MET → kcal conversion. PoseCoach
 * stores no body metrics, so the equivalent is explicitly "for an average
 * adult" and the UI says so — it is never presented as personalised.
 */
export const REFERENCE_BODY_WEIGHT_KG = 70

/**
 * MET values from the 2011 Compendium of Physical Activities. Three everyday,
 * low-barrier activities — deliberately no high-intensity "burn" options.
 */
export interface Activity {
  readonly key: string
  readonly label: string
  readonly met: number
}

export const ACTIVITIES: readonly Activity[] = [
  { key: "walk", label: "brisk walk", met: 4.3 },
  { key: "cycle", label: "easy bike ride", met: 6.8 },
  { key: "jog", label: "gentle jog", met: 8.3 },
]

/** Energy cost of an activity: kcal/min = MET × 3.5 × kg / 200. */
export function kcalPerMinute(met: number, weightKg: number = REFERENCE_BODY_WEIGHT_KG): number {
  return (met * 3.5 * weightKg) / 200
}

/** One activity with the rough minutes that match a surplus. */
export interface ActivityEquivalent extends Activity {
  readonly minutes: number
}

/**
 * Rough minutes of each activity matching `surplusKcal`, rounded to the nearest
 * 5 minutes (a precise number would imply a precision this estimate does not
 * have) with a 5-minute floor. A non-positive surplus yields an empty list —
 * there is nothing to give context for.
 */
export function activityEquivalents(
  surplusKcal: number,
  weightKg: number = REFERENCE_BODY_WEIGHT_KG,
): ActivityEquivalent[] {
  if (!Number.isFinite(surplusKcal) || surplusKcal <= 0) return []
  return ACTIVITIES.map((a) => ({
    ...a,
    minutes: Math.max(5, Math.round(surplusKcal / kcalPerMinute(a.met, weightKg) / 5) * 5),
  }))
}
