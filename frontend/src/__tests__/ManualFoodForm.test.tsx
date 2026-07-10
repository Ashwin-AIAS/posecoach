import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/nutritionApi", () => ({
  createManualFood: vi.fn(),
}))

import { createManualFood } from "../lib/nutritionApi"
import { ManualFoodForm } from "../components/ManualFoodForm"
import type { FoodItemOut } from "../types"

const CREATED: FoodItemOut = {
  id: "f2",
  barcode: null,
  name: "Dal",
  brand: null,
  serving_size_g: 150,
  serving_label: null,
  kcal_100g: 120,
  protein_100g: 7,
  carbs_100g: 18,
  fat_100g: 2,
  image_url: null,
  source: "manual",
}

beforeEach(() => vi.clearAllMocks())

describe("ManualFoodForm", () => {
  it("disables save until name and kcal are present", () => {
    render(<ManualFoodForm onCreated={vi.fn()} onCancel={vi.fn()} />)
    const save = screen.getByTestId("mf-save")
    expect(save).toBeDisabled()

    fireEvent.change(screen.getByTestId("mf-name"), { target: { value: "Dal" } })
    expect(save).toBeDisabled()

    fireEvent.change(screen.getByTestId("mf-kcal"), { target: { value: "120" } })
    expect(save).toBeEnabled()
  })

  it("submits numeric fields and omits blanks", async () => {
    vi.mocked(createManualFood).mockResolvedValueOnce(CREATED)
    const onCreated = vi.fn()
    render(<ManualFoodForm onCreated={onCreated} onCancel={vi.fn()} />)

    fireEvent.change(screen.getByTestId("mf-name"), { target: { value: "  Dal  " } })
    fireEvent.change(screen.getByTestId("mf-kcal"), { target: { value: "120" } })
    fireEvent.change(screen.getByTestId("mf-protein"), { target: { value: "7" } })
    fireEvent.change(screen.getByTestId("mf-serving"), { target: { value: "150" } })
    fireEvent.click(screen.getByTestId("mf-save"))

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED))
    expect(vi.mocked(createManualFood)).toHaveBeenCalledWith({
      name: "Dal",
      kcal_100g: 120,
      protein_100g: 7,
      carbs_100g: undefined,
      fat_100g: undefined,
      serving_size_g: 150,
    })
  })

  it("shows the API error and stays editable", async () => {
    vi.mocked(createManualFood).mockRejectedValueOnce(new Error("Request failed (401)"))
    render(<ManualFoodForm onCreated={vi.fn()} onCancel={vi.fn()} />)

    fireEvent.change(screen.getByTestId("mf-name"), { target: { value: "Dal" } })
    fireEvent.change(screen.getByTestId("mf-kcal"), { target: { value: "120" } })
    fireEvent.click(screen.getByTestId("mf-save"))

    expect(await screen.findByRole("alert")).toHaveTextContent(/401/)
    expect(screen.getByTestId("mf-save")).toBeEnabled()
  })

  it("cancel hands control back to the panel", () => {
    const onCancel = vi.fn()
    render(<ManualFoodForm onCreated={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByTestId("mf-cancel"))
    expect(onCancel).toHaveBeenCalled()
  })
})
