import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/workoutsApi", () => ({
  getExerciseHistory: vi.fn(async () => ({
    slug: "barbell-squat",
    name: "Barbell Squat",
    total_sets: 0,
    total_volume_kg: 0,
    best_one_rep_max: 0,
    entries: [],
  })),
}))

import { getExerciseHistory } from "../lib/workoutsApi"
import { ExerciseDetail } from "../components/ExerciseDetail"
import type { ExerciseDetail as ExerciseDetailType } from "../types"

const BASE: ExerciseDetailType = {
  id: "1",
  slug: "barbell-squat",
  name: "Barbell Squat",
  category: "strength",
  equipment: "barbell",
  primary_muscles: ["quadriceps"],
  secondary_muscles: ["glutes"],
  instructions: ["Stand with bar.", "Squat to depth."],
  image_urls: ["https://cdn.example.com/squat/0.jpg", "https://cdn.example.com/squat/1.jpg"],
  youtube_id: "CWl0apMgshk",
  is_cv_supported: true, is_custom: false,
}

const NO_CV: ExerciseDetailType = {
  ...BASE,
  slug: "cable-fly",
  name: "Cable Fly",
  youtube_id: null,
  is_cv_supported: false, is_custom: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.removeItem("pc.units")
})

describe("ExerciseDetail", () => {
  it("hides the Progress section when the exercise has no history", async () => {
    render(<ExerciseDetail exercise={BASE} onBack={vi.fn()} />)
    await waitFor(() => expect(vi.mocked(getExerciseHistory)).toHaveBeenCalledWith("barbell-squat"))
    expect(screen.queryByTestId("progress-section")).not.toBeInTheDocument()
  })

  it("shows the Progress chart and PR line once history loads", async () => {
    vi.mocked(getExerciseHistory).mockResolvedValueOnce({
      slug: "barbell-squat",
      name: "Barbell Squat",
      total_sets: 3,
      total_volume_kg: 1500,
      best_one_rep_max: 116.7,
      entries: [
        // Newest first, as the API returns them.
        {
          workout_id: "w2",
          performed_at: "2026-07-02T10:00:00Z",
          weight_kg: 105,
          reps: 3,
          est_one_rep_max: 115.5,
        },
        {
          workout_id: "w1",
          performed_at: "2026-07-01T10:00:00Z",
          weight_kg: 100,
          reps: 5,
          est_one_rep_max: 116.7,
        },
        {
          workout_id: "w1",
          performed_at: "2026-07-01T10:00:00Z",
          weight_kg: 100,
          reps: 4,
          est_one_rep_max: 113.3,
        },
      ],
    })
    render(<ExerciseDetail exercise={BASE} onBack={vi.fn()} />)

    expect(await screen.findByTestId("progress-section")).toBeInTheDocument()
    expect(screen.getByTestId("progression-chart")).toBeInTheDocument()
    // The PR is the highest-e1RM set: 100 kg × 5 → 116.7.
    expect(screen.getByTestId("pr-line")).toHaveTextContent("100 kg × 5")
    expect(screen.getByTestId("pr-line")).toHaveTextContent("116.7 kg")
  })

  it("renders the exercise name", () => {
    render(<ExerciseDetail exercise={BASE} onBack={vi.fn()} />)
    expect(screen.getByText("Barbell Squat")).toBeInTheDocument()
  })

  it("shows the Form-check CV badge for a CV-supported exercise", () => {
    render(<ExerciseDetail exercise={BASE} onBack={vi.fn()} />)
    expect(screen.getByTestId("cv-badge")).toBeInTheDocument()
  })

  it("hides the CV badge for a non-CV exercise", () => {
    render(<ExerciseDetail exercise={NO_CV} onBack={vi.fn()} />)
    expect(screen.queryByTestId("cv-badge")).not.toBeInTheDocument()
  })

  it("renders instructions as an ordered list", () => {
    render(<ExerciseDetail exercise={BASE} onBack={vi.fn()} />)
    expect(screen.getByText("Stand with bar.")).toBeInTheDocument()
    expect(screen.getByText("Squat to depth.")).toBeInTheDocument()
  })

  it("calls onBack when the back button is clicked", () => {
    const onBack = vi.fn()
    render(<ExerciseDetail exercise={BASE} onBack={onBack} />)
    fireEvent.click(screen.getByTestId("exercise-detail-back"))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it("shows the play button for the video initially (lite-embed pattern)", () => {
    render(<ExerciseDetail exercise={BASE} onBack={vi.fn()} />)
    expect(screen.getByLabelText("Play Barbell Squat demo video")).toBeInTheDocument()
  })

  it("does not render a play button when there is no youtube_id", () => {
    render(<ExerciseDetail exercise={NO_CV} onBack={vi.fn()} />)
    expect(screen.queryByRole("button", { name: /play/i })).not.toBeInTheDocument()
  })
})
