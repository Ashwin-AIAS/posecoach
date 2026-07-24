import { describe, expect, it } from "vitest"

import { inferMeal, previewMacros } from "../lib/macros"
import type { FoodItemOut } from "../types"

const FOOD: FoodItemOut = {
  id: "f1",
  barcode: null,
  name: "Nutella",
  brand: null,
  serving_size_g: 15,
  serving_label: null,
  kcal_100g: 539,
  protein_100g: 6.3,
  carbs_100g: 57.5,
  fat_100g: 30.9,
  image_url: null,
  source: "off",
}

describe("previewMacros", () => {
  it("scales per-100 g values by amount and rounds to 2 decimals (server formula)", () => {
    // Same numbers the backend snapshot test uses: 30 g of Nutella.
    expect(previewMacros(FOOD, 30)).toEqual({
      kcal: 161.7,
      protein_g: 1.89,
      carbs_g: 17.25,
      fat_g: 9.27,
    })
  })

  it("is identity at exactly 100 g", () => {
    expect(previewMacros(FOOD, 100)).toEqual({
      kcal: 539,
      protein_g: 6.3,
      carbs_g: 57.5,
      fat_g: 30.9,
    })
  })

  it("handles fractional serving amounts", () => {
    expect(previewMacros(FOOD, 15).kcal).toBeCloseTo(80.85, 2)
  })
})

describe("inferMeal (P34.1 one-tap default)", () => {
  /** Build a local-time Date at the given hour (minute optional). */
  const at = (hour: number, minute = 0): Date => new Date(2026, 6, 24, hour, minute)

  it("before 11:00 is breakfast", () => {
    expect(inferMeal(at(0))).toBe("breakfast")
    expect(inferMeal(at(7, 30))).toBe("breakfast")
    expect(inferMeal(at(10, 59))).toBe("breakfast")
  })

  it("11:00–15:59 is lunch", () => {
    expect(inferMeal(at(11))).toBe("lunch")
    expect(inferMeal(at(13, 30))).toBe("lunch")
    expect(inferMeal(at(15, 59))).toBe("lunch")
  })

  it("16:00–20:59 is dinner", () => {
    expect(inferMeal(at(16))).toBe("dinner")
    expect(inferMeal(at(19))).toBe("dinner")
    expect(inferMeal(at(20, 59))).toBe("dinner")
  })

  it("21:00 onward is snack", () => {
    expect(inferMeal(at(21))).toBe("snack")
    expect(inferMeal(at(23, 59))).toBe("snack")
  })
})
