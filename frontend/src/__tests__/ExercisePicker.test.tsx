import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/workoutsApi", () => ({
  listExercises: vi.fn(),
  createCustomExercise: vi.fn(),
}))

import { createCustomExercise, listExercises } from "../lib/workoutsApi"
import type { ExerciseSummary } from "../types"
import { ExercisePicker } from "../components/ExercisePicker"

const mockList = vi.mocked(listExercises)
const mockCreateCustom = vi.mocked(createCustomExercise)

const FIXTURE: ExerciseSummary[] = [
  {
    id: "1",
    slug: "barbell-squat",
    name: "Barbell Squat",
    category: "strength",
    equipment: "barbell",
    primary_muscles: ["quadriceps"],
    secondary_muscles: ["glutes"],
    image_urls: [],
    youtube_id: null,
    is_cv_supported: true,
    is_custom: false,
  },
]

beforeEach(() => {
  vi.resetAllMocks()
  window.localStorage.removeItem("pc.catalog.v1")
  mockList.mockResolvedValue(FIXTURE)
})

describe("ExercisePicker", () => {
  it("picks an exercise from search results", async () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    render(<ExercisePicker onPick={onPick} onClose={onClose} />)
    await waitFor(() => screen.getByTestId("picker-row-barbell-squat"))

    fireEvent.click(screen.getByTestId("picker-row-barbell-squat"))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ slug: "barbell-squat" }))
    expect(onClose).toHaveBeenCalled()
  })

  it("creates a custom exercise from the empty-results state and picks it immediately", async () => {
    const created: ExerciseSummary = {
      id: "custom-1",
      slug: "custom-abcd1234",
      name: "Landmine Twist",
      category: null,
      equipment: null,
      primary_muscles: [],
      secondary_muscles: [],
      image_urls: [],
      youtube_id: null,
      is_cv_supported: false,
      is_custom: true,
    }
    mockCreateCustom.mockResolvedValue({ ...created, instructions: [] })
    const onPick = vi.fn()
    const onClose = vi.fn()

    render(<ExercisePicker onPick={onPick} onClose={onClose} />)
    await waitFor(() => screen.getByTestId("picker-row-barbell-squat"))

    fireEvent.change(screen.getByLabelText("Search exercises"), {
      target: { value: "nonexistent-exercise-zzz" },
    })
    await waitFor(() => screen.getByTestId("add-custom-exercise"))
    fireEvent.click(screen.getByTestId("add-custom-exercise"))

    fireEvent.change(await screen.findByPlaceholderText("e.g. Landmine Twist"), {
      target: { value: "Landmine Twist" },
    })
    fireEvent.click(screen.getByTestId("custom-exercise-submit"))

    await waitFor(() => expect(onPick).toHaveBeenCalledWith(expect.objectContaining(created)))
    expect(onClose).toHaveBeenCalled()
  })
})
