import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/workoutsApi", () => ({
  listExercises: vi.fn(),
  createCustomExercise: vi.fn(),
}))

import { createCustomExercise, listExercises } from "../lib/workoutsApi"
import { UnauthenticatedError } from "../lib/api"
import type { ExerciseSummary } from "../types"
import { ExerciseLibrary } from "../components/ExerciseLibrary"

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
    image_urls: ["https://cdn.example.com/squat/0.jpg"],
    youtube_id: "CWl0apMgshk",
    is_cv_supported: true, is_custom: false,
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
    is_cv_supported: false, is_custom: false,
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

  describe("P29: catalog load failure vs empty search", () => {
    it("shows a sign-in card when the catalog fetch 401s (no cache to fall back to)", async () => {
      mockList.mockRejectedValueOnce(new UnauthenticatedError("Sign in required"))
      const onSignIn = vi.fn()
      render(<ExerciseLibrary onSelect={vi.fn()} onSignIn={onSignIn} />)

      expect(await screen.findByTestId("sign-in-prompt")).toHaveTextContent(
        "Sign in to browse the exercise library",
      )
      fireEvent.click(screen.getByTestId("sign-in-prompt-btn"))
      expect(onSignIn).toHaveBeenCalled()
    })

    it("shows a couldn't-load error with retry on a network failure, distinct from 'no results'", async () => {
      mockList.mockRejectedValueOnce(new TypeError("Failed to fetch"))
      render(<ExerciseLibrary onSelect={vi.fn()} />)

      expect(await screen.findByTestId("error-retry")).toHaveTextContent(
        "Couldn't load the exercise catalog.",
      )
      expect(screen.queryByText("No exercises found.")).not.toBeInTheDocument()

      fireEvent.click(screen.getByTestId("error-retry-btn"))
      await waitFor(() => expect(screen.getByTestId("exercise-row-barbell-squat")).toBeInTheDocument())
    })

    it("an empty search still shows the plain 'no results' text, not an error card", async () => {
      render(<ExerciseLibrary onSelect={vi.fn()} />)
      await waitFor(() => screen.getByTestId("exercise-row-barbell-squat"))

      fireEvent.change(screen.getByLabelText("Search exercises"), {
        target: { value: "nonexistent-exercise-zzz" },
      })

      await waitFor(() => expect(screen.getByText("No exercises found.")).toBeInTheDocument())
      expect(screen.queryByTestId("error-retry")).not.toBeInTheDocument()
      expect(screen.queryByTestId("sign-in-prompt")).not.toBeInTheDocument()
    })
  })

  describe("P29: add custom exercise", () => {
    it("creates a custom exercise from the empty-search state and selects it immediately", async () => {
      const created: ExerciseSummary = {
        id: "custom-1",
        slug: "custom-abcd1234",
        name: "Landmine Twist",
        category: null,
        equipment: null,
        primary_muscles: ["abdominals"],
        secondary_muscles: [],
        image_urls: [],
        youtube_id: null,
        is_cv_supported: false,
        is_custom: true,
      }
      mockCreateCustom.mockResolvedValue({ ...created, instructions: [] })
      const onSelect = vi.fn()

      render(<ExerciseLibrary onSelect={onSelect} />)
      await waitFor(() => screen.getByTestId("exercise-row-barbell-squat"))

      fireEvent.change(screen.getByLabelText("Search exercises"), {
        target: { value: "nonexistent-exercise-zzz" },
      })
      await waitFor(() => screen.getByTestId("add-custom-exercise"))
      fireEvent.click(screen.getByTestId("add-custom-exercise"))

      const sheet = await screen.findByTestId("custom-exercise-sheet")
      fireEvent.change(screen.getByPlaceholderText("e.g. Landmine Twist"), {
        target: { value: "Landmine Twist" },
      })
      fireEvent.click(screen.getByTestId("custom-exercise-submit"))

      await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining(created)))
      expect(mockCreateCustom).toHaveBeenCalledWith({
        name: "Landmine Twist",
        primaryMuscle: undefined,
      })
      expect(sheet).not.toBeInTheDocument()
    })

    it("shows the create error inline and keeps the sheet open on failure", async () => {
      mockCreateCustom.mockRejectedValueOnce(new TypeError("Failed to fetch"))
      render(<ExerciseLibrary onSelect={vi.fn()} />)
      await waitFor(() => screen.getByTestId("exercise-row-barbell-squat"))

      fireEvent.change(screen.getByLabelText("Search exercises"), {
        target: { value: "nonexistent-exercise-zzz" },
      })
      await waitFor(() => screen.getByTestId("add-custom-exercise"))
      fireEvent.click(screen.getByTestId("add-custom-exercise"))

      fireEvent.change(screen.getByPlaceholderText("e.g. Landmine Twist"), {
        target: { value: "Landmine Twist" },
      })
      fireEvent.click(screen.getByTestId("custom-exercise-submit"))

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "You're offline — check your connection and try again.",
      )
      expect(screen.getByTestId("custom-exercise-sheet")).toBeInTheDocument()
    })
  })
})
