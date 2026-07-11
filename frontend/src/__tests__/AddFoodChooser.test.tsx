import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/nutritionApi", () => ({
  searchFoods: vi.fn(),
}))

import { searchFoods } from "../lib/nutritionApi"
import { AddFoodChooser } from "../components/AddFoodChooser"
import type { FoodItemOut } from "../types"

const FOOD: FoodItemOut = {
  id: "f1",
  barcode: "3017620422003",
  name: "Nutella",
  brand: "Ferrero",
  serving_size_g: 15,
  serving_label: null,
  kcal_100g: 539,
  protein_100g: 6.3,
  carbs_100g: 57.5,
  fat_100g: 30.9,
  image_url: null,
  source: "off",
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

async function typeAndSettle(value: string): Promise<void> {
  fireEvent.change(screen.getByTestId("food-search-input"), { target: { value } })
  await act(async () => {
    vi.advanceTimersByTime(350)
  })
}

describe("AddFoodChooser", () => {
  it("debounces the search: no call before the delay, one call after", async () => {
    vi.mocked(searchFoods).mockResolvedValue([FOOD])
    render(<AddFoodChooser onScan={vi.fn()} onManual={vi.fn()} onPick={vi.fn()} />)

    fireEvent.change(screen.getByTestId("food-search-input"), { target: { value: "nut" } })
    expect(vi.mocked(searchFoods)).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(350)
    })
    expect(vi.mocked(searchFoods)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(searchFoods)).toHaveBeenCalledWith("nut")
    expect(screen.getByTestId("food-result-f1")).toBeInTheDocument()
  })

  it("retyping within the delay collapses to a single call", async () => {
    vi.mocked(searchFoods).mockResolvedValue([FOOD])
    render(<AddFoodChooser onScan={vi.fn()} onManual={vi.fn()} onPick={vi.fn()} />)

    fireEvent.change(screen.getByTestId("food-search-input"), { target: { value: "nu" } })
    act(() => {
      vi.advanceTimersByTime(150)
    })
    await typeAndSettle("nutella")

    expect(vi.mocked(searchFoods)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(searchFoods)).toHaveBeenCalledWith("nutella")
  })

  it("queries under 2 characters never hit the API", async () => {
    render(<AddFoodChooser onScan={vi.fn()} onManual={vi.fn()} onPick={vi.fn()} />)
    await typeAndSettle("n")
    expect(vi.mocked(searchFoods)).not.toHaveBeenCalled()
  })

  it("picking a result hands the food to onPick", async () => {
    vi.mocked(searchFoods).mockResolvedValue([FOOD])
    const onPick = vi.fn()
    render(<AddFoodChooser onScan={vi.fn()} onManual={vi.fn()} onPick={onPick} />)

    await typeAndSettle("nutella")
    fireEvent.click(screen.getByTestId("food-result-f1"))
    expect(onPick).toHaveBeenCalledWith(FOOD)
  })

  it("no matches shows the fallback note", async () => {
    vi.mocked(searchFoods).mockResolvedValue([])
    render(<AddFoodChooser onScan={vi.fn()} onManual={vi.fn()} onPick={vi.fn()} />)

    await typeAndSettle("zzz")
    expect(screen.getByTestId("search-empty")).toBeInTheDocument()
  })

  it("a failed search shows an inline error, not a crash", async () => {
    vi.mocked(searchFoods).mockRejectedValue(new Error("Request failed (503)"))
    render(<AddFoodChooser onScan={vi.fn()} onManual={vi.fn()} onPick={vi.fn()} />)

    await typeAndSettle("nutella")
    expect(screen.getByTestId("search-error")).toBeInTheDocument()
  })

  it("scan and manual entry points fire their callbacks", () => {
    const onScan = vi.fn()
    const onManual = vi.fn()
    render(<AddFoodChooser onScan={onScan} onManual={onManual} onPick={vi.fn()} />)

    fireEvent.click(screen.getByTestId("scan-btn"))
    expect(onScan).toHaveBeenCalled()
    fireEvent.click(screen.getByTestId("manual-entry-btn"))
    expect(onManual).toHaveBeenCalled()
  })
})
