/**
 * Pure macro-snapshot math (P28), mirroring the server formula in
 * app/nutrition/service.py::snapshot_macros: amount_g × per-100 g / 100,
 * rounded to 2 decimals. Client-side it is a PREVIEW only — the POST /log
 * response (server-computed) always replaces these numbers.
 */

import type { DailyTotals, FoodItemOut, Meal } from "../types"

/** Diary meals in fixed display order, with their UI labels. */
export const MEALS: readonly Meal[] = ["breakfast", "lunch", "dinner", "snack"]
export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
}

/** Server rows carry `meal` as a plain string — coerce unknowns to "snack". */
export function asMeal(meal: string): Meal {
  return (MEALS as readonly string[]).includes(meal) ? (meal as Meal) : "snack"
}

/**
 * Infer the diary meal from the local time of day (P34.1): breakfast before
 * 11:00, lunch 11:00–16:00, dinner 16:00–21:00, snack otherwise. Used to
 * pre-fill a one-tap scan log so a scan writes to a sensible meal without a
 * second prompt; the user can still change it via "Adjust". Pure — takes the
 * clock as an argument so it is deterministic under test.
 */
export function inferMeal(now: Date = new Date()): Meal {
  const hour = now.getHours()
  if (hour < 11) return "breakfast"
  if (hour < 16) return "lunch"
  if (hour < 21) return "dinner"
  return "snack"
}

/** Compact display number: 1 decimal with a trailing ".0" dropped. */
export function fmt(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** kcal/P/C/F for `amountG` grams of `food` — preview of the server snapshot. */
export function previewMacros(food: FoodItemOut, amountG: number): DailyTotals {
  const factor = amountG / 100
  return {
    kcal: round2(food.kcal_100g * factor),
    protein_g: round2(food.protein_100g * factor),
    carbs_g: round2(food.carbs_100g * factor),
    fat_g: round2(food.fat_100g * factor),
  }
}

/**
 * Sum entry snapshots into day totals. Matches the server's GET /log totals
 * exactly: both sum the same already-rounded snapshot columns.
 */
export function sumTotals(entries: readonly { kcal: number; protein_g: number; carbs_g: number; fat_g: number }[]): DailyTotals {
  return entries.reduce<DailyTotals>(
    (acc, e) => ({
      kcal: acc.kcal + e.kcal,
      protein_g: acc.protein_g + e.protein_g,
      carbs_g: acc.carbs_g + e.carbs_g,
      fat_g: acc.fat_g + e.fat_g,
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  )
}
