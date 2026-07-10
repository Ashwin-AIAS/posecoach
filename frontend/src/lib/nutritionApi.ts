/**
 * Typed wrappers for the P27 /api/v1/nutrition endpoints.
 * Uses the same `apiFetch`/`apiJson` helpers as the rest of the app.
 */

import { apiFetch, apiJson } from "./api"
import type { DailyLogOut, FoodItemOut, LogEntryOut, Meal } from "../types"

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

// ── P28: diary wrappers ───────────────────────────────────────────────────────

export interface LogFoodBody {
  food_item_id: string
  /** ISO `YYYY-MM-DD` for the diary day the entry belongs to. */
  logged_date: string
  meal: Meal
  amount_g: number
}

/** Add a food to the diary — macros are snapshotted server-side. */
export async function logFood(body: LogFoodBody): Promise<LogEntryOut> {
  return apiJson<LogEntryOut>("/api/v1/nutrition/log", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

/** One diary day: entries (insertion order) + server-computed totals. */
export async function getDailyLog(dateISO: string): Promise<DailyLogOut> {
  const params = new URLSearchParams({ date: dateISO })
  return apiJson<DailyLogOut>(`/api/v1/nutrition/log?${params.toString()}`)
}

export interface LogEntryPatch {
  logged_date?: string
  meal?: Meal
  amount_g?: number
}

/** Edit a diary entry — the server recomputes the macro snapshot on amount change. */
export async function updateLogEntry(id: string, patch: LogEntryPatch): Promise<LogEntryOut> {
  return apiJson<LogEntryOut>(`/api/v1/nutrition/log/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

/**
 * Remove a diary entry. The API answers 204 with no body, so this bypasses
 * `apiJson` (which always parses JSON) and maps failures to the server detail.
 */
export async function deleteLogEntry(id: string): Promise<void> {
  const resp = await apiFetch(`/api/v1/nutrition/log/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
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
}
