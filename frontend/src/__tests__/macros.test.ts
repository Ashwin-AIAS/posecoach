import { describe, expect, it } from "vitest"

import { previewMacros } from "../lib/macros"
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
