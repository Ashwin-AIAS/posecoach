import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The scanner needs a camera — replace it with a button that fires a decode.
vi.mock("../components/BarcodeScanner", () => ({
  BarcodeScanner: ({
    onDecoded,
  }: {
    onDecoded: (digits: string) => void
  }) => (
    <button type="button" data-testid="fake-scanner" onClick={() => onDecoded("3017620422003")}>
      fake scanner
    </button>
  ),
}))

vi.mock("../lib/nutritionApi", () => ({
  lookupBarcode: vi.fn(),
  createManualFood: vi.fn(),
  logFood: vi.fn(),
  getDailyLog: vi.fn(),
  searchFoods: vi.fn(),
  updateLogEntry: vi.fn(),
  deleteLogEntry: vi.fn(),
}))

import { createManualFood, getDailyLog, logFood, lookupBarcode, updateLogEntry } from "../lib/nutritionApi"
import { CaloriesPanel } from "../components/CaloriesPanel"
import { todayISO } from "../lib/day"
import type { DailyLogOut, FoodItemOut, LogEntryOut } from "../types"

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

function emptyDay(): DailyLogOut {
  return {
    log_date: todayISO(),
    entries: [],
    totals: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getDailyLog).mockResolvedValue(emptyDay())
})

afterEach(() => {
  vi.useRealTimers()
})

/** A logged snack entry for `FOOD` at its 15 g serving (80.85 kcal). */
function loggedSnack(): LogEntryOut {
  return {
    id: "e1",
    logged_date: todayISO(),
    meal: "snack",
    amount_g: 15,
    kcal: 80.85,
    protein_g: 0.95,
    carbs_g: 8.63,
    fat_g: 4.64,
    food: FOOD,
  }
}

/** P28: the tab lands on the diary — the add-flow starts from "Add food". */
async function openAddFlow(): Promise<void> {
  fireEvent.click(await screen.findByTestId("diary-empty-add"))
}

async function scanOnce(): Promise<void> {
  await openAddFlow()
  fireEvent.click(screen.getByTestId("scan-btn"))
  fireEvent.click(screen.getByTestId("fake-scanner"))
}

describe("CaloriesPanel", () => {
  it("lands on today's diary (P28 home): day nav + totals", async () => {
    render(<CaloriesPanel />)
    expect(await screen.findByTestId("day-nav")).toBeInTheDocument()
    expect(screen.getByTestId("day-label")).toHaveTextContent("Today")
    expect(screen.getByTestId("daily-totals")).toBeInTheDocument()
    expect(vi.mocked(getDailyLog)).toHaveBeenCalledWith(todayISO())
  })

  it("scan → macro card with kcal and per-serving values", async () => {
    vi.mocked(lookupBarcode).mockResolvedValueOnce(FOOD)
    render(<CaloriesPanel />)

    await scanOnce()

    expect(await screen.findByTestId("food-macro-card")).toBeInTheDocument()
    expect(vi.mocked(lookupBarcode)).toHaveBeenCalledWith("3017620422003")
    expect(screen.getByTestId("kcal-headline")).toHaveTextContent("539")
    expect(screen.getByText("Nutella")).toBeInTheDocument()
    // Community-data disclaimer (roadmap requirement for OFF rows).
    expect(screen.getByText(/Open Food Facts/)).toBeInTheDocument()
    // 15 g serving → 80.9 kcal.
    expect(screen.getByText(/80\.9 kcal/)).toBeInTheDocument()
  })

  it("unknown barcode → not-found state → manual form → card + add sheet", async () => {
    vi.mocked(lookupBarcode).mockResolvedValueOnce(null)
    vi.mocked(createManualFood).mockResolvedValueOnce({
      ...FOOD,
      id: "f2",
      barcode: null,
      name: "Homemade bar",
      source: "manual",
    })
    render(<CaloriesPanel />)

    await scanOnce()

    expect(await screen.findByTestId("not-found")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("not-found-manual-btn"))

    fireEvent.change(screen.getByTestId("mf-name"), { target: { value: "Homemade bar" } })
    fireEvent.change(screen.getByTestId("mf-kcal"), { target: { value: "450" } })
    fireEvent.click(screen.getByTestId("mf-save"))

    expect(await screen.findByTestId("food-macro-card")).toBeInTheDocument()
    expect(vi.mocked(createManualFood)).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Homemade bar", kcal_100g: 450 }),
    )
    expect(screen.getByText("Your manual entry.")).toBeInTheDocument()
    // A just-created manual food is ready to log straight away (P28).
    expect(screen.getByTestId("add-to-diary-sheet")).toBeInTheDocument()
  })

  it("OFF outage shows the error state with a way back to the chooser", async () => {
    vi.mocked(lookupBarcode).mockRejectedValueOnce(
      new Error("food database unreachable — try again shortly"),
    )
    render(<CaloriesPanel />)

    await scanOnce()

    expect(await screen.findByTestId("lookup-error")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent(/unreachable/)
    fireEvent.click(screen.getByTestId("error-back-btn"))
    expect(screen.getByTestId("scan-btn")).toBeInTheDocument()
  })

  it("signed-out lookup maps the 401 to a friendly message", async () => {
    vi.mocked(lookupBarcode).mockRejectedValueOnce(new Error("Request failed (401)"))
    render(<CaloriesPanel />)

    await scanOnce()

    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in to look up foods.")
  })

  it("manual entry is reachable from the add-food chooser", async () => {
    render(<CaloriesPanel />)
    await openAddFlow()
    fireEvent.click(screen.getByTestId("manual-entry-btn"))
    expect(screen.getByTestId("manual-food-form")).toBeInTheDocument()
  })

  it("cancelling the scanner returns to the chooser", async () => {
    render(<CaloriesPanel />)
    await openAddFlow()
    fireEvent.click(screen.getByTestId("scan-btn"))
    expect(screen.getByTestId("fake-scanner")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("cancel-scan-btn"))
    expect(screen.getByTestId("scan-btn")).toBeInTheDocument()
  })

  it("the back button leaves the add-flow for the diary", async () => {
    render(<CaloriesPanel />)
    await openAddFlow()
    fireEvent.click(screen.getByTestId("add-back-btn"))
    expect(await screen.findByTestId("day-nav")).toBeInTheDocument()
  })

  it("scan → product → one tap logs immediately with default amount + inferred meal (P34.1)", async () => {
    // Pin the clock to local lunchtime so the inferred meal is deterministic.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(2026, 6, 24, 12, 30))
    vi.mocked(lookupBarcode).mockResolvedValueOnce(FOOD)
    vi.mocked(logFood).mockResolvedValueOnce({ ...loggedSnack(), meal: "lunch" })
    render(<CaloriesPanel />)

    await scanOnce()

    // One tap on the product card logs it — no intermediate sheet.
    fireEvent.click(await screen.findByTestId("add-to-diary-btn"))
    expect(screen.queryByTestId("add-to-diary-sheet")).not.toBeInTheDocument()

    // Default amount = serving_size_g (15), meal inferred from local time (lunch).
    expect(vi.mocked(logFood)).toHaveBeenCalledWith({
      food_item_id: "f1",
      logged_date: todayISO(),
      meal: "lunch",
      amount_g: 15,
    })

    // Success confirmation renders with the kcal + meal line.
    expect(await screen.findByTestId("log-confirmation")).toBeInTheDocument()
    expect(screen.getByTestId("log-confirmation-text")).toHaveTextContent("Added · 80.9 kcal to Lunch")
  })

  it("no serving size → one tap defaults the amount to 100 g", async () => {
    const noServing = { ...FOOD, serving_size_g: null, serving_label: null }
    vi.mocked(lookupBarcode).mockResolvedValueOnce(noServing)
    vi.mocked(logFood).mockResolvedValueOnce({ ...loggedSnack(), amount_g: 100 })
    render(<CaloriesPanel />)

    await scanOnce()
    fireEvent.click(await screen.findByTestId("add-to-diary-btn"))

    expect(vi.mocked(logFood)).toHaveBeenCalledWith(
      expect.objectContaining({ amount_g: 100 }),
    )
  })

  it("confirmation → Adjust opens the edit sheet pre-filled on that entry", async () => {
    vi.mocked(lookupBarcode).mockResolvedValueOnce(FOOD)
    vi.mocked(logFood).mockResolvedValueOnce(loggedSnack())
    render(<CaloriesPanel />)

    await scanOnce()
    fireEvent.click(await screen.findByTestId("add-to-diary-btn"))
    fireEvent.click(await screen.findByTestId("adjust-btn"))

    // Edit mode: the sheet is pre-filled with the logged amount + meal.
    expect(screen.getByTestId("add-to-diary-sheet")).toHaveTextContent("Edit entry")
    expect(screen.getByTestId("atd-amount")).toHaveValue("15")
    expect(screen.getByTestId("meal-chip-snack")).toHaveAttribute("aria-pressed", "true")

    // Saving PATCHes that entry (not a second log) and returns to the diary.
    vi.mocked(updateLogEntry).mockResolvedValueOnce({ ...loggedSnack(), amount_g: 30 })
    fireEvent.click(screen.getByTestId("atd-submit"))
    expect(await screen.findByTestId("day-nav")).toBeInTheDocument()
    expect(vi.mocked(updateLogEntry)).toHaveBeenCalledWith("e1", { meal: "snack", amount_g: 15 })
  })

  it("a failed one-tap log surfaces inline with a retry — never a silent close", async () => {
    vi.mocked(lookupBarcode).mockResolvedValueOnce(FOOD)
    vi.mocked(logFood)
      .mockRejectedValueOnce(new Error("network hiccup"))
      .mockResolvedValueOnce(loggedSnack())
    render(<CaloriesPanel />)

    await scanOnce()
    fireEvent.click(await screen.findByTestId("add-to-diary-btn"))

    // Stays on the product card with an inline error — not back on the diary.
    expect(await screen.findByTestId("log-error")).toHaveTextContent("network hiccup")
    expect(screen.getByTestId("food-macro-card")).toBeInTheDocument()

    // Tapping the same button retries and succeeds.
    fireEvent.click(screen.getByTestId("add-to-diary-btn"))
    expect(await screen.findByTestId("log-confirmation")).toBeInTheDocument()
    await waitFor(() => expect(vi.mocked(logFood)).toHaveBeenCalledTimes(2))
  })
})
