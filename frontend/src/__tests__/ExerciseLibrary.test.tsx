import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/workoutsApi", () => ({
  listExercises: vi.fn(),
}))

import { listExercises } from "../lib/workoutsApi"
import type { ExerciseSummary } from "../types"
import { ExerciseLibrary } from "../components/ExerciseLibrary"

const mockList = vi.mocked(listExercises)

const FIXTURE: ExerciseSummary[] = [
  {
    id: "1",
    slug: "barbell-squat",
    name: "Barbell Squat",
    category: "strength",
    equipment: "barbell",
    primary_muscles: ["quadriceps"],
    secondary_muscles: ["glutes"],
    image_urls: ["https://cdn.example.com/squat/0.jpg"],
    youtube_id: "CWl0apMgshk",
    is_cv_supported: true,
  },
  {
    id: "2",
    slug: "cable-fly",
    name: "Cable Fly",
    category: "strength",
    equipment: "cable",
    primary_muscles: ["chest"],
    secondary_muscles: [],
    image_urls: [],
    youtube_id: null,
    is_cv_supported: false,
  },
]

beforeEach(() => {
  vi.resetAllMocks()
  window.localStorage.removeItem("pc.catalog.v1")
  mockList.mockResolvedValue(FIXTURE)
})

describe("ExerciseLibrary", () => {
  it("renders the library container", async () => {
    render(<ExerciseLibrary onSelect={vi.fn()} />)
    expect(screen.getByTestId("exercise-library")).toBeInTheDocument()
  })

  it("shows exercise rows after loading", async () => {
    render(<ExerciseLibrary onSelect={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByTestId("exercise-row-barbell-squat")).toBeInTheDocument(),
    )
    expect(screen.getByTestId("exercise-row-cable-fly")).toBeInTheDocument()
  })

  it("filters rows by search query", async () => {
    render(<ExerciseLibrary onSelect={vi.fn()} />)
    await waitFor(() => screen.getByTestId("exercise-row-barbell-squat"))

    fireEvent.change(screen.getByLabelText("Search exercises"), {
      target: { value: "squat" },
    })

    await waitFor(() => {
      expect(screen.getByTestId("exercise-row-barbell-squat")).toBeInTheDocument()
      expect(screen.queryByTestId("exercise-row-cable-fly")).not.toBeInTheDocument()
    })
  })

  it("calls onSelect when a row is clicked", async () => {
    const onSelect = vi.fn()
    render(<ExerciseLibrary onSelect={onSelect} />)
    await waitFor(() => screen.getByTestId("exercise-row-barbell-squat"))

    fireEvent.click(screen.getByTestId("exercise-row-barbell-squat"))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ slug: "barbell-squat" }))
  })
})
