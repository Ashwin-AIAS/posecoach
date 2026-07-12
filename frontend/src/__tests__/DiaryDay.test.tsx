import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/nutritionApi", () => ({
  getDailyLog: vi.fn(),
  deleteLogEntry: vi.fn(),
  updateLogEntry: vi.fn(),
  logFood: vi.fn(),
}))

import { deleteLogEntry, getDailyLog, updateLogEntry } from "../lib/nutritionApi"
import { UnauthenticatedError } from "../lib/api"
import { DiaryDay } from "../components/DiaryDay"
import { addDays, todayISO } from "../lib/day"
import type { DailyLogOut, FoodItemOut, LogEntryOut } from "../types"

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

function mkEntry(id: string, meal: string, kcal: number, date = todayISO()): LogEntryOut {
  return {
    id,
    logged_date: date,
    meal,
    amount_g: 100,
    kcal,
    protein_g: 10,
    carbs_g: 20,
    fat_g: 5,
    food: { ...FOOD, id: `food-${id}`, name: `Food ${id}` },
  }
}

function mkDay(entries: LogEntryOut[], date = todayISO()): DailyLogOut {
  return {
    log_date: date,
    entries,
    totals: {
      kcal: entries.reduce((a, e) => a + e.kcal, 0),
      protein_g: entries.reduce((a, e) => a + e.protein_g, 0),
      carbs_g: entries.reduce((a, e) => a + e.carbs_g, 0),
      fat_g: entries.reduce((a, e) => a + e.fat_g, 0),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("DiaryDay", () => {
  it("renders totals and entries grouped by meal with subtotals", async () => {
    vi.mocked(getDailyLog).mockResolvedValue(
      mkDay([mkEntry("e1", "breakfast", 100), mkEntry("e2", "breakfast", 50), mkEntry("e3", "dinner", 200)]),
    )
    render(<DiaryDay dateISO={todayISO()} onDateChange={vi.fn()} onAddFood={vi.fn()} />)

    expect(await screen.findByTestId("daily-totals")).toBeInTheDocument()
    expect(screen.getByTestId("totals-kcal")).toHaveTextContent("350")
    expect(screen.getByTestId("meal-section-breakfast")).toBeInTheDocument()
    expect(screen.getByTestId("meal-subtotal-breakfast")).toHaveTextContent("150 kcal")
    expect(screen.getByTestId("meal-section-dinner")).toBeInTheDocument()
    expect(screen.getByTestId("meal-subtotal-dinner")).toHaveTextContent("200 kcal")
    // No lunch/snack entries → no empty sections.
    expect(screen.queryByTestId("meal-section-lunch")).not.toBeInTheDocument()
    expect(screen.queryByTestId("meal-section-snack")).not.toBeInTheDocument()
  })

  it("shows a skeleton on first load", () => {
    vi.mocked(getDailyLog).mockReturnValue(new Promise(() => undefined)) // never resolves
    render(<DiaryDay dateISO={todayISO()} onDateChange={vi.fn()} onAddFood={vi.fn()} />)
    expect(screen.getByTestId("diary-skeleton")).toBeInTheDocument()
  })

  it("prev navigates a day back and a date change refetches", async () => {
    const today = todayISO()
    const yesterday = addDays(today, -1)
    vi.mocked(getDailyLog).mockResolvedValue(mkDay([], today))
    const onDateChange = vi.fn()
    const view = render(<DiaryDay dateISO={today} onDateChange={onDateChange} onAddFood={vi.fn()} />)
    await screen.findByTestId("daily-totals")

    fireEvent.click(screen.getByTestId("day-prev"))
    expect(onDateChange).toHaveBeenCalledWith(yesterday)

    vi.mocked(getDailyLog).mockResolvedValue(mkDay([], yesterday))
    view.rerender(<DiaryDay dateISO={yesterday} onDateChange={onDateChange} onAddFood={vi.fn()} />)
    await waitFor(() => expect(vi.mocked(getDailyLog)).toHaveBeenLastCalledWith(yesterday))
    expect(await screen.findByTestId("day-label")).toHaveTextContent("Yesterday")
  })

  it("cannot page into the future: next and Today are disabled on today", async () => {
    vi.mocked(getDailyLog).mockResolvedValue(mkDay([]))
    render(<DiaryDay dateISO={todayISO()} onDateChange={vi.fn()} onAddFood={vi.fn()} />)
    await screen.findByTestId("daily-totals")
    expect(screen.getByTestId("day-next")).toBeDisabled()
    expect(screen.getByTestId("day-today")).toBeDisabled()
  })

  it("next and Today are enabled on a past day", async () => {
    const yesterday = addDays(todayISO(), -1)
    vi.mocked(getDailyLog).mockResolvedValue(mkDay([], yesterday))
    const onDateChange = vi.fn()
    render(<DiaryDay dateISO={yesterday} onDateChange={onDateChange} onAddFood={vi.fn()} />)
    await screen.findByTestId("daily-totals")

    expect(screen.getByTestId("day-next")).not.toBeDisabled()
    fireEvent.click(screen.getByTestId("day-today"))
    expect(onDateChange).toHaveBeenCalledWith(todayISO())
  })

  it("empty day shows the friendly state and Add food fires onAddFood", async () => {
    vi.mocked(getDailyLog).mockResolvedValue(mkDay([]))
    const onAddFood = vi.fn()
    render(<DiaryDay dateISO={todayISO()} onDateChange={vi.fn()} onAddFood={onAddFood} />)

    fireEvent.click(await screen.findByTestId("diary-empty-add"))
    expect(onAddFood).toHaveBeenCalled()
  })

  it("fetch failure shows the error state; retry refetches and recovers", async () => {
    vi.mocked(getDailyLog)
      .mockRejectedValueOnce(new Error("Request failed (503)"))
      .mockResolvedValueOnce(mkDay([mkEntry("e1", "snack", 99)]))
    render(<DiaryDay dateISO={todayISO()} onDateChange={vi.fn()} onAddFood={vi.fn()} />)

    expect(await screen.findByTestId("diary-error")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("diary-retry"))

    expect(await screen.findByTestId("daily-totals")).toBeInTheDocument()
    expect(screen.getByTestId("totals-kcal")).toHaveTextContent("99")
  })

  it("signed-out fetch shows a sign-in card that deep-links to Settings (P29)", async () => {
    vi.mocked(getDailyLog).mockRejectedValueOnce(new UnauthenticatedError("Sign in required"))
    const onSignIn = vi.fn()
    render(<DiaryDay dateISO={todayISO()} onDateChange={vi.fn()} onAddFood={vi.fn()} onSignIn={onSignIn} />)

    expect(await screen.findByTestId("sign-in-prompt")).toHaveTextContent(
      "Sign in to see your food diary",
    )
    expect(screen.queryByTestId("diary-error")).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId("sign-in-prompt-btn"))
    expect(onSignIn).toHaveBeenCalled()
  })

  it("delete is optimistic and Undo restores the row without any DELETE call", async () => {
    vi.mocked(getDailyLog).mockResolvedValue(mkDay([mkEntry("e1", "lunch", 120)]))
    render(<DiaryDay dateISO={todayISO()} onDateChange={vi.fn()} onAddFood={vi.fn()} />)
    await screen.findByTestId("entry-row-e1")

    vi.useFakeTimers()
    fireEvent.click(screen.getByTestId("entry-delete-e1"))
    expect(screen.queryByTestId("entry-row-e1")).not.toBeInTheDocument()
    expect(screen.getByTestId("totals-kcal")).toHaveTextContent("0")

    fireEvent.click(screen.getByTestId("undo-btn"))
    expect(screen.getByTestId("entry-row-e1")).toBeInTheDocument()
    expect(screen.getByTestId("totals-kcal")).toHaveTextContent("120")

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(vi.mocked(deleteLogEntry)).not.toHaveBeenCalled()
  })

  it("the DELETE is sent once the undo window closes", async () => {
    vi.mocked(getDailyLog).mockResolvedValue(mkDay([mkEntry("e1", "lunch", 120)]))
    vi.mocked(deleteLogEntry).mockResolvedValue(undefined)
    render(<DiaryDay dateISO={todayISO()} onDateChange={vi.fn()} onAddFood={vi.fn()} />)
    await screen.findByTestId("entry-row-e1")

    vi.useFakeTimers()
    fireEvent.click(screen.getByTestId("entry-delete-e1"))
    expect(screen.getByTestId("undo-bar")).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5_001)
    })
    expect(vi.mocked(deleteLogEntry)).toHaveBeenCalledWith("e1")
    expect(screen.queryByTestId("undo-bar")).not.toBeInTheDocument()
  })

  it("a failed DELETE restores the row with a note", async () => {
    vi.mocked(getDailyLog).mockResolvedValue(mkDay([mkEntry("e1", "lunch", 120)]))
    vi.mocked(deleteLogEntry).mockRejectedValue(new Error("Request failed (500)"))
    render(<DiaryDay dateISO={todayISO()} onDateChange={vi.fn()} onAddFood={vi.fn()} />)
    await screen.findByTestId("entry-row-e1")

    vi.useFakeTimers()
    fireEvent.click(screen.getByTestId("entry-delete-e1"))
    await act(async () => {
      vi.advanceTimersByTime(5_001)
    })
    vi.useRealTimers()

    expect(await screen.findByTestId("entry-row-e1")).toBeInTheDocument()
    expect(screen.getByTestId("delete-error")).toBeInTheDocument()
    expect(screen.getByTestId("totals-kcal")).toHaveTextContent("120")
  })

  it("tapping a row opens the edit sheet prefilled; saving reconciles the row and totals", async () => {
    const entry = mkEntry("e1", "lunch", 120)
    vi.mocked(getDailyLog).mockResolvedValue(mkDay([entry]))
    vi.mocked(updateLogEntry).mockResolvedValue({ ...entry, amount_g: 200, kcal: 240 })
    render(<DiaryDay dateISO={todayISO()} onDateChange={vi.fn()} onAddFood={vi.fn()} />)

    fireEvent.click(await screen.findByTestId("entry-edit-e1"))
    expect(screen.getByTestId("add-to-diary-sheet")).toBeInTheDocument()
    expect(screen.getByTestId("atd-amount")).toHaveValue("100")

    fireEvent.change(screen.getByTestId("atd-amount"), { target: { value: "200" } })
    fireEvent.click(screen.getByTestId("atd-submit"))

    await waitFor(() =>
      expect(vi.mocked(updateLogEntry)).toHaveBeenCalledWith("e1", { meal: "lunch", amount_g: 200 }),
    )
    expect(await screen.findByTestId("totals-kcal")).toHaveTextContent("240")
    expect(screen.queryByTestId("add-to-diary-sheet")).not.toBeInTheDocument()
  })

  it("a 404 on edit (foreign/deleted entry) surfaces an error, not a crash", async () => {
    const entry = mkEntry("e1", "lunch", 120)
    vi.mocked(getDailyLog).mockResolvedValue(mkDay([entry]))
    vi.mocked(updateLogEntry).mockRejectedValue(new Error("log entry not found"))
    render(<DiaryDay dateISO={todayISO()} onDateChange={vi.fn()} onAddFood={vi.fn()} />)

    fireEvent.click(await screen.findByTestId("entry-edit-e1"))
    fireEvent.click(screen.getByTestId("atd-submit"))

    expect(await screen.findByRole("alert")).toHaveTextContent("log entry not found")
    expect(screen.getByTestId("add-to-diary-sheet")).toBeInTheDocument() // still open, retry possible
  })
})
