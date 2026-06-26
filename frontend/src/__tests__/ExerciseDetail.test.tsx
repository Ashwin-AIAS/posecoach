import { render, screen, fireEvent } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

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
  is_cv_supported: true,
}

const NO_CV: ExerciseDetailType = {
  ...BASE,
  slug: "cable-fly",
  name: "Cable Fly",
  youtube_id: null,
  is_cv_supported: false,
}

describe("ExerciseDetail", () => {
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
