import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { calculatePlates } from "../lib/plateCalculator"
import { PlateCalculator } from "../components/PlateCalculator"

describe("calculatePlates (pure math)", () => {
  it("100kg on a 20kg bar → 2×20kg + 2×5kg per side (40kg per side = 80kg + 20kg)", () => {
    const plates = calculatePlates(100, 20)
    const total = plates.reduce((sum, p) => sum + p.weight * p.count, 0)
    expect(total).toBeCloseTo(40, 1)
  })

  it("returns empty when target equals bar weight", () => {
    expect(calculatePlates(20, 20)).toHaveLength(0)
  })

  it("returns empty when target is less than bar weight", () => {
    expect(calculatePlates(15, 20)).toHaveLength(0)
  })

  it("60kg on 20kg bar = 20kg per side → 1×20kg", () => {
    const plates = calculatePlates(60, 20)
    expect(plates).toEqual(expect.arrayContaining([{ weight: 20, count: 1 }]))
    const total = plates.reduce((sum, p) => sum + p.weight * p.count, 0)
    expect(total).toBeCloseTo(20, 1)
  })
})

describe("PlateCalculator component", () => {
  it("renders with testid", () => {
    render(<PlateCalculator />)
    expect(screen.getByTestId("plate-calculator")).toBeInTheDocument()
  })

  it("renders target and bar inputs", () => {
    render(<PlateCalculator />)
    expect(screen.getByTestId("plate-calc-target")).toBeInTheDocument()
    expect(screen.getByTestId("plate-calc-bar")).toBeInTheDocument()
  })
})
