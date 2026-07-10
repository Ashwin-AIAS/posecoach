import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { FoodMacroCard } from "../components/FoodMacroCard"
import type { FoodItemOut } from "../types"

const BASE: FoodItemOut = {
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

describe("FoodMacroCard", () => {
  it("shows kcal per 100 g plus per-serving values when the serving is known", () => {
    render(<FoodMacroCard food={BASE} />)
    expect(screen.getByTestId("kcal-headline")).toHaveTextContent("539")
    expect(screen.getByText(/80\.9 kcal \/ 1 tbsp \(15 g\)/)).toBeInTheDocument()
    // 6.3 g protein / 100 g → 0.9 g per 15 g serving.
    expect(screen.getByText(/0\.9 g \/ serving/)).toBeInTheDocument()
  })

  it("omits serving values when the serving size is unknown", () => {
    render(<FoodMacroCard food={{ ...BASE, serving_size_g: null, serving_label: null }} />)
    expect(screen.queryByText(/serving/)).not.toBeInTheDocument()
  })

  it("labels manual entries instead of the community disclaimer", () => {
    render(<FoodMacroCard food={{ ...BASE, source: "manual", barcode: null }} />)
    expect(screen.getByText("Your manual entry.")).toBeInTheDocument()
    expect(screen.queryByText(/Open Food Facts/)).not.toBeInTheDocument()
  })
})
