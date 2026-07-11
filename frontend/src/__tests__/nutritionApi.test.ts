import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createManualFood,
  deleteLogEntry,
  getDailyLog,
  logFood,
  lookupBarcode,
  searchFoods,
  updateLogEntry,
} from "../lib/nutritionApi"
import type { FoodItemOut, LogEntryOut } from "../types"

const FOOD: FoodItemOut = {
  id: "f1",
  barcode: "3017620422003",
  name: "Nutella",
  brand: "Ferrero",
  serving_size_g: 15,
  serving_label: "1 tbsp (15 g)",
  kcal_100g: 539,
  protein_100g: 6.3,
  carbs_100g: 57.5,
  fat_100g: 30.9,
  image_url: null,
  source: "off",
}

function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal("fetch", fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("lookupBarcode", () => {
  it("returns the product on 200", async () => {
    const fn = mockFetch(200, FOOD)
    const result = await lookupBarcode("3017620422003")
    expect(result?.name).toBe("Nutella")
    expect(String(fn.mock.calls[0]?.[0])).toContain("/api/v1/nutrition/products/3017620422003")
  })

  it("resolves null on a 404 miss (manual-entry path, not an error)", async () => {
    mockFetch(404, { detail: "product not found" })
    await expect(lookupBarcode("4000000000000")).resolves.toBeNull()
  })

  it("throws the server detail when OFF is down", async () => {
    mockFetch(503, { detail: "food database unreachable — try again shortly" })
    await expect(lookupBarcode("4000000000000")).rejects.toThrow(/unreachable/)
  })
})

describe("createManualFood", () => {
  it("POSTs the per-100g body and returns the created food", async () => {
    const fn = mockFetch(201, { ...FOOD, id: "f2", source: "manual", barcode: null })
    const created = await createManualFood({ name: "Dal", kcal_100g: 120, protein_100g: 7 })
    expect(created.source).toBe("manual")
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toMatchObject({ name: "Dal", kcal_100g: 120 })
  })
})

describe("searchFoods", () => {
  it("encodes the query and returns rows", async () => {
    const fn = mockFetch(200, [FOOD])
    const rows = await searchFoods("nutella spread")
    expect(rows).toHaveLength(1)
    expect(String(fn.mock.calls[0]?.[0])).toContain("q=nutella+spread")
  })
})

// ── P28 diary wrappers ────────────────────────────────────────────────────────

const ENTRY: LogEntryOut = {
  id: "e1",
  logged_date: "2026-07-10",
  meal: "breakfast",
  amount_g: 30,
  kcal: 161.7,
  protein_g: 1.89,
  carbs_g: 17.25,
  fat_g: 9.27,
  food: FOOD,
}

describe("logFood", () => {
  it("POSTs the entry body to /log and returns the created row", async () => {
    const fn = mockFetch(201, ENTRY)
    const created = await logFood({
      food_item_id: "f1",
      logged_date: "2026-07-10",
      meal: "breakfast",
      amount_g: 30,
    })
    expect(created.id).toBe("e1")
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain("/api/v1/nutrition/log")
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toMatchObject({
      food_item_id: "f1",
      logged_date: "2026-07-10",
      meal: "breakfast",
      amount_g: 30,
    })
  })

  it("surfaces the server detail on failure", async () => {
    mockFetch(404, { detail: "food not found" })
    await expect(
      logFood({ food_item_id: "nope", logged_date: "2026-07-10", meal: "snack", amount_g: 100 }),
    ).rejects.toThrow(/food not found/)
  })
})

describe("getDailyLog", () => {
  it("GETs /log with the date param and returns entries + totals", async () => {
    const fn = mockFetch(200, {
      log_date: "2026-07-10",
      entries: [ENTRY],
      totals: { kcal: 161.7, protein_g: 1.89, carbs_g: 17.25, fat_g: 9.27 },
    })
    const day = await getDailyLog("2026-07-10")
    expect(day.entries).toHaveLength(1)
    expect(day.totals.kcal).toBeCloseTo(161.7)
    expect(String(fn.mock.calls[0]?.[0])).toContain("/api/v1/nutrition/log?date=2026-07-10")
  })
})

describe("updateLogEntry", () => {
  it("PATCHes only the given fields and returns the updated row", async () => {
    const fn = mockFetch(200, { ...ENTRY, amount_g: 45, kcal: 242.55 })
    const updated = await updateLogEntry("e1", { amount_g: 45 })
    expect(updated.amount_g).toBe(45)
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain("/api/v1/nutrition/log/e1")
    expect(init.method).toBe("PATCH")
    expect(JSON.parse(String(init.body))).toEqual({ amount_g: 45 })
  })

  it("surfaces a 404 (foreign or deleted entry) as an error, not a crash", async () => {
    mockFetch(404, { detail: "log entry not found" })
    await expect(updateLogEntry("someone-elses", { meal: "lunch" })).rejects.toThrow(/not found/)
  })
})

describe("deleteLogEntry", () => {
  it("DELETEs the entry and resolves void on 204 (no body to parse)", async () => {
    const fn = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fn)
    await expect(deleteLogEntry("e1")).resolves.toBeUndefined()
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toContain("/api/v1/nutrition/log/e1")
    expect(init.method).toBe("DELETE")
  })

  it("throws the server detail on failure", async () => {
    mockFetch(404, { detail: "log entry not found" })
    await expect(deleteLogEntry("gone")).rejects.toThrow(/not found/)
  })
})
