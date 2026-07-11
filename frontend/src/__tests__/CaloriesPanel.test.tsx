import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

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

import { createManualFood, getDailyLog, logFood, lookupBarcode } from "../lib/nutritionApi"
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

  it("product card → Add to diary → sheet logs it → back on the diary (P28)", async () => {
    vi.mocked(lookupBarcode).mockResolvedValueOnce(FOOD)
    const entry: LogEntryOut = {
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
    vi.mocked(logFood).mockResolvedValueOnce(entry)
    render(<CaloriesPanel />)

    await scanOnce()

    fireEvent.click(await screen.findByTestId("add-to-diary-btn"))
    expect(screen.getByTestId("add-to-diary-sheet")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("atd-submit"))

    // Success returns to the diary, which refetches the viewed day.
    expect(await screen.findByTestId("day-nav")).toBeInTheDocument()
    expect(vi.mocked(logFood)).toHaveBeenCalledWith(
      expect.objectContaining({ food_item_id: "f1", amount_g: 15, logged_date: todayISO() }),
    )
    expect(vi.mocked(getDailyLog).mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it("cancelling the add-to-diary sheet returns to the product card", async () => {
    vi.mocked(lookupBarcode).mockResolvedValueOnce(FOOD)
    render(<CaloriesPanel />)

    await scanOnce()

    fireEvent.click(await screen.findByTestId("add-to-diary-btn"))
    fireEvent.click(screen.getByTestId("atd-cancel"))

    expect(screen.getByTestId("add-to-diary-btn")).toBeInTheDocument()
    expect(vi.mocked(logFood)).not.toHaveBeenCalled()
  })
})
