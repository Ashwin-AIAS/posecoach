/**
 * Pure macro-snapshot math (P28), mirroring the server formula in
 * app/nutrition/service.py::snapshot_macros: amount_g × per-100 g / 100,
 * rounded to 2 decimals. Client-side it is a PREVIEW only — the POST /log
 * response (server-computed) always replaces these numbers.
 */

import type { DailyTotals, FoodItemOut } from "../types"

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
