/**
 * Typed wrappers for the P27 /api/v1/nutrition endpoints.
 * Uses the same `apiFetch`/`apiJson` helpers as the rest of the app.
 */

import { apiFetch, apiJson } from "./api"
import type { FoodItemOut } from "../types"

/**
 * Barcode → product macros. A miss (OFF doesn't know the code) resolves to
 * `null` so the panel can offer manual entry; every other failure throws with
 * the server's detail message (e.g. the 503 "food database unreachable").
 */
export async function lookupBarcode(barcode: string): Promise<FoodItemOut | null> {
  const resp = await apiFetch(`/api/v1/nutrition/products/${encodeURIComponent(barcode)}`)
  if (resp.status === 404) return null
  if (!resp.ok) {
    let detail = `Request failed (${resp.status})`
    try {
      const body = (await resp.json()) as { detail?: string }
      if (body.detail) detail = body.detail
    } catch {
      // fall through with default message
    }
    throw new Error(detail)
  }
  return (await resp.json()) as FoodItemOut
}

export interface ManualFoodBody {
  name: string
  kcal_100g: number
  protein_100g?: number
  carbs_100g?: number
  fat_100g?: number
  brand?: string
  serving_size_g?: number
  serving_label?: string
}

/** The "not found → type it in" fallback — creates a food only its creator sees. */
export async function createManualFood(body: ManualFoodBody): Promise<FoodItemOut> {
  return apiJson<FoodItemOut>("/api/v1/nutrition/foods", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

/** Search cached products + the caller's own manual foods (used by P28's diary). */
export async function searchFoods(q: string, limit = 20): Promise<FoodItemOut[]> {
  const params = new URLSearchParams({ q, limit: String(limit) })
  return apiJson<FoodItemOut[]>(`/api/v1/nutrition/foods/search?${params.toString()}`)
}
