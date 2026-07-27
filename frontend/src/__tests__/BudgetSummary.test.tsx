import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { BudgetSummary } from "../components/BudgetSummary"
import type { DailyTotals, NutritionGoalOut } from "../types"

const TOTALS: DailyTotals = { kcal: 1250, protein_g: 90, carbs_g: 140, fat_g: 40 }

function goal(over: Partial<NutritionGoalOut> = {}): NutritionGoalOut {
  return {
    kcal_target: 2000,
    protein_target_g: 150,
    carbs_target_g: null,
    fat_target_g: null,
    updated_at: "2026-07-27T10:00:00Z",
    ...over,
  }
}

describe("BudgetSummary — no target", () => {
  it("falls back to plain totals (the P28 hero) with no remaining line", () => {
    render(<BudgetSummary totals={TOTALS} />)
    expect(screen.getByTestId("totals-kcal")).toHaveTextContent("1250")
    expect(screen.queryByTestId("remaining-kcal")).not.toBeInTheDocument()
    expect(screen.queryByTestId("consumed-of-target")).not.toBeInTheDocument()
  })

  it("offers a one-tap way to set a target when the panel provides one", () => {
    const onEditTarget = vi.fn()
    render(<BudgetSummary totals={TOTALS} goal={null} onEditTarget={onEditTarget} />)
    fireEvent.click(screen.getByTestId("set-target-btn"))
    expect(onEditTarget).toHaveBeenCalled()
  })

  it("an all-null goal is the same as no goal", () => {
    render(
      <BudgetSummary
        totals={TOTALS}
        goal={{
          kcal_target: null,
          protein_target_g: null,
          carbs_target_g: null,
          fat_target_g: null,
          updated_at: null,
        }}
      />,
    )
    expect(screen.getByTestId("totals-kcal")).toHaveTextContent("1250")
    expect(screen.queryByTestId("remaining-kcal")).not.toBeInTheDocument()
  })
})

describe("BudgetSummary — under target", () => {
  it("heroes what's left and keeps consumed visible", () => {
    render(<BudgetSummary totals={TOTALS} goal={goal()} />)
    expect(screen.getByTestId("remaining-kcal")).toHaveTextContent("750") // 2000 − 1250
    expect(screen.getByText("kcal left")).toBeInTheDocument()
    expect(screen.getByTestId("consumed-of-target")).toHaveTextContent("1250 of 2000 kcal")
  })

  it("shows remaining protein when a protein target is tracked", () => {
    render(<BudgetSummary totals={TOTALS} goal={goal()} />)
    expect(screen.getByTestId("remaining-protein")).toHaveTextContent("60 g left of 150 g")
  })

  it("omits the protein line when that macro isn't tracked", () => {
    render(<BudgetSummary totals={TOTALS} goal={goal({ protein_target_g: null })} />)
    expect(screen.queryByTestId("remaining-protein")).not.toBeInTheDocument()
  })

  it("shows no over-budget note while under the target", () => {
    render(<BudgetSummary totals={TOTALS} goal={goal()} />)
    expect(screen.queryByTestId("over-budget-note")).not.toBeInTheDocument()
  })

  it("offers editing an existing target", () => {
    const onEditTarget = vi.fn()
    render(<BudgetSummary totals={TOTALS} goal={goal()} onEditTarget={onEditTarget} />)
    fireEvent.click(screen.getByTestId("edit-target-btn"))
    expect(onEditTarget).toHaveBeenCalled()
  })
})

describe("BudgetSummary — over target", () => {
  const overTotals: DailyTotals = { ...TOTALS, kcal: 2320, protein_g: 170 }

  it("states how far over, calmly and without shaming language", () => {
    render(<BudgetSummary totals={overTotals} goal={goal()} />)
    expect(screen.getByTestId("remaining-kcal")).toHaveTextContent("320")
    expect(screen.getByText("kcal over")).toBeInTheDocument()
    const note = screen.getByTestId("over-budget-note")
    expect(note).toHaveTextContent("no stress")
    expect(note.textContent ?? "").not.toMatch(/burn|should|must|failed|bad|guilt|cheat/i)
  })

  it("reports protein over the target without turning it into a warning", () => {
    render(<BudgetSummary totals={overTotals} goal={goal()} />)
    expect(screen.getByTestId("remaining-protein")).toHaveTextContent("20 g over of 150 g")
  })

  it("keeps the activity equivalent hidden until the user asks for it", () => {
    render(<BudgetSummary totals={overTotals} goal={goal()} />)
    expect(screen.queryByTestId("activity-equivalent")).not.toBeInTheDocument()

    const toggle = screen.getByTestId("activity-toggle")
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(toggle)

    const panel = screen.getByTestId("activity-equivalent")
    // 320 kcal ≈ 60 min brisk walk / 30 min gentle jog for a 70 kg adult.
    expect(panel).toHaveTextContent("60 min")
    expect(panel).toHaveTextContent("brisk walk")
    expect(panel).toHaveTextContent("Just for context")
    expect(panel.textContent ?? "").not.toMatch(/burn|work off|need to burn|compensat/i)
  })

  it("the reveal toggles back closed", () => {
    render(<BudgetSummary totals={overTotals} goal={goal()} />)
    fireEvent.click(screen.getByTestId("activity-toggle"))
    expect(screen.getByTestId("activity-equivalent")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("activity-toggle"))
    expect(screen.queryByTestId("activity-equivalent")).not.toBeInTheDocument()
  })
})
