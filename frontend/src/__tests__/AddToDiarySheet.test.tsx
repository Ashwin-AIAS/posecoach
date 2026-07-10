import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/nutritionApi", () => ({
  logFood: vi.fn(),
}))

import { logFood } from "../lib/nutritionApi"
import { AddToDiarySheet } from "../components/AddToDiarySheet"
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

const NO_SERVING: FoodItemOut = { ...FOOD, id: "f2", serving_size_g: null, serving_label: null }

const ENTRY: LogEntryOut = {
  id: "e1",
  logged_date: "2026-07-10",
  meal: "breakfast",
  amount_g: 15,
  kcal: 80.85,
  protein_g: 0.95,
  carbs_g: 8.63,
  fat_g: 4.64,
  food: FOOD,
}

beforeEach(() => vi.clearAllMocks())

describe("AddToDiarySheet", () => {
  it("prefills the amount from serving_size_g when the food has one", () => {
    render(
      <AddToDiarySheet food={FOOD} dateISO="2026-07-10" onLogged={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(screen.getByTestId("atd-amount")).toHaveValue("15")
    // 15 g of 539 kcal/100 g → 80.85 kcal preview.
    expect(screen.getByTestId("log-preview")).toHaveTextContent("80.9")
  })

  it("defaults to 100 g when the food has no serving size (and hides the chips)", () => {
    render(
      <AddToDiarySheet
        food={NO_SERVING}
        dateISO="2026-07-10"
        onLogged={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByTestId("atd-amount")).toHaveValue("100")
    expect(screen.queryByTestId("atd-serving-chip")).not.toBeInTheDocument()
    expect(screen.getByTestId("log-preview")).toHaveTextContent("539")
  })

  it("recomputes the live preview when the amount changes", () => {
    render(
      <AddToDiarySheet food={FOOD} dateISO="2026-07-10" onLogged={vi.fn()} onCancel={vi.fn()} />,
    )
    fireEvent.change(screen.getByTestId("atd-amount"), { target: { value: "200" } })
    expect(screen.getByTestId("log-preview")).toHaveTextContent("1078")
    // Macro line scales too: 6.3 g/100 g protein → 12.6 g at 200 g.
    expect(screen.getByTestId("log-preview")).toHaveTextContent("P 12.6")
  })

  it("quick chips switch between one serving and 100 g", () => {
    render(
      <AddToDiarySheet food={FOOD} dateISO="2026-07-10" onLogged={vi.fn()} onCancel={vi.fn()} />,
    )
    fireEvent.click(screen.getByTestId("atd-100g-chip"))
    expect(screen.getByTestId("atd-amount")).toHaveValue("100")
    fireEvent.click(screen.getByTestId("atd-serving-chip"))
    expect(screen.getByTestId("atd-amount")).toHaveValue("15")
  })

  it("logs the picked meal and amount to the viewed day and returns the entry", async () => {
    vi.mocked(logFood).mockResolvedValueOnce(ENTRY)
    const onLogged = vi.fn()
    render(
      <AddToDiarySheet food={FOOD} dateISO="2026-07-09" onLogged={onLogged} onCancel={vi.fn()} />,
    )

    fireEvent.click(screen.getByTestId("meal-chip-breakfast"))
    fireEvent.click(screen.getByTestId("atd-submit"))

    await waitFor(() => expect(onLogged).toHaveBeenCalledWith(ENTRY))
    expect(vi.mocked(logFood)).toHaveBeenCalledWith({
      food_item_id: "f1",
      logged_date: "2026-07-09",
      meal: "breakfast",
      amount_g: 15,
    })
  })

  it("disables submit while the POST is pending", async () => {
    let resolve!: (e: LogEntryOut) => void
    vi.mocked(logFood).mockReturnValueOnce(
      new Promise<LogEntryOut>((r) => {
        resolve = r
      }),
    )
    render(
      <AddToDiarySheet food={FOOD} dateISO="2026-07-10" onLogged={vi.fn()} onCancel={vi.fn()} />,
    )

    fireEvent.click(screen.getByTestId("atd-submit"))
    expect(screen.getByTestId("atd-submit")).toBeDisabled()
    resolve(ENTRY)
    await waitFor(() => expect(vi.mocked(logFood)).toHaveBeenCalledTimes(1))
  })

  it("disables submit for an invalid amount", () => {
    render(
      <AddToDiarySheet food={FOOD} dateISO="2026-07-10" onLogged={vi.fn()} onCancel={vi.fn()} />,
    )
    fireEvent.change(screen.getByTestId("atd-amount"), { target: { value: "0" } })
    expect(screen.getByTestId("atd-submit")).toBeDisabled()
    fireEvent.change(screen.getByTestId("atd-amount"), { target: { value: "abc" } })
    expect(screen.getByTestId("atd-submit")).toBeDisabled()
  })

  it("shows the server error inline and does not call onLogged", async () => {
    vi.mocked(logFood).mockRejectedValueOnce(new Error("food not found"))
    const onLogged = vi.fn()
    render(
      <AddToDiarySheet food={FOOD} dateISO="2026-07-10" onLogged={onLogged} onCancel={vi.fn()} />,
    )

    fireEvent.click(screen.getByTestId("atd-submit"))

    expect(await screen.findByRole("alert")).toHaveTextContent("food not found")
    expect(onLogged).not.toHaveBeenCalled()
    expect(screen.getByTestId("atd-submit")).not.toBeDisabled() // retry allowed
  })

  it("cancel calls onCancel without logging", () => {
    const onCancel = vi.fn()
    render(
      <AddToDiarySheet food={FOOD} dateISO="2026-07-10" onLogged={vi.fn()} onCancel={onCancel} />,
    )
    fireEvent.click(screen.getByTestId("atd-cancel"))
    expect(onCancel).toHaveBeenCalled()
    expect(vi.mocked(logFood)).not.toHaveBeenCalled()
  })
})
