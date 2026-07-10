import { afterEach, describe, expect, it, vi } from "vitest"

import { createManualFood, lookupBarcode, searchFoods } from "../lib/nutritionApi"
import type { FoodItemOut } from "../types"

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
