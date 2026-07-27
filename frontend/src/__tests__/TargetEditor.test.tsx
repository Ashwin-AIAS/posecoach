import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { TargetEditor } from "../components/TargetEditor"
import type { NutritionGoalOut } from "../types"

const SAVED: NutritionGoalOut = {
  kcal_target: 2400,
  protein_target_g: 160,
  carbs_target_g: null,
  fat_target_g: null,
  updated_at: "2026-07-27T10:00:00Z",
}

describe("TargetEditor", () => {
  it("saves kcal with optional macros left out entirely", async () => {
    const onSave = vi.fn().mockResolvedValue(SAVED)
    const onSaved = vi.fn()
    render(<TargetEditor goal={null} onSave={onSave} onSaved={onSaved} onCancel={vi.fn()} />)

    fireEvent.change(screen.getByTestId("te-kcal"), { target: { value: "2400" } })
    fireEvent.click(screen.getByTestId("te-save"))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        kcal_target: 2400,
        protein_target_g: undefined,
        carbs_target_g: undefined,
        fat_target_g: undefined,
      }),
    )
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it("prefills from an existing goal", () => {
    render(<TargetEditor goal={SAVED} onSave={vi.fn()} onSaved={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByTestId("te-kcal")).toHaveValue("2400")
    expect(screen.getByTestId("te-protein")).toHaveValue("160")
    expect(screen.getByTestId("te-carbs")).toHaveValue("")
  })

  it("cannot be saved empty, non-numeric, zero, or past the typo ceiling", () => {
    render(<TargetEditor goal={null} onSave={vi.fn()} onSaved={vi.fn()} onCancel={vi.fn()} />)
    const kcal = screen.getByTestId("te-kcal")
    const save = screen.getByTestId("te-save")

    expect(save).toBeDisabled() // empty
    for (const bad of ["lots", "-100", "0", "20001"]) {
      fireEvent.change(kcal, { target: { value: bad } })
      expect(save).toBeDisabled()
    }
    fireEvent.change(kcal, { target: { value: "2400" } })
    expect(save).not.toBeDisabled()
  })

  it("rejects an out-of-range macro target before the server has to", () => {
    render(<TargetEditor goal={null} onSave={vi.fn()} onSaved={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByTestId("te-kcal"), { target: { value: "2400" } })
    fireEvent.change(screen.getByTestId("te-protein"), { target: { value: "5000" } })
    expect(screen.getByTestId("te-save")).toBeDisabled()
  })

  it("a failed save stays open with an inline error and the button as the retry", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error("Request failed (503)"))
      .mockResolvedValueOnce(SAVED)
    const onSaved = vi.fn()
    render(<TargetEditor goal={null} onSave={onSave} onSaved={onSaved} onCancel={vi.fn()} />)

    fireEvent.change(screen.getByTestId("te-kcal"), { target: { value: "2400" } })
    fireEvent.click(screen.getByTestId("te-save"))

    expect(await screen.findByTestId("te-error")).toHaveTextContent("Request failed (503)")
    expect(onSaved).not.toHaveBeenCalled() // never looks like success
    expect(screen.getByTestId("target-editor")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("te-save"))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it("cancel leaves without saving", () => {
    const onCancel = vi.fn()
    const onSave = vi.fn()
    render(<TargetEditor goal={null} onSave={onSave} onSaved={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByTestId("te-cancel"))
    expect(onCancel).toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it("suggests nothing and gives no advice (health-values guardrail)", () => {
    render(<TargetEditor goal={null} onSave={vi.fn()} onSaved={vi.fn()} onCancel={vi.fn()} />)
    const text = screen.getByTestId("target-editor").textContent ?? ""
    expect(text).not.toMatch(/lose|deficit|recommend|should eat|weight|BMI|burn/i)
    expect(screen.getByTestId("te-kcal")).toHaveValue("") // no pre-filled suggestion
  })
})
