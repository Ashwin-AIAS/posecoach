import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/workoutsApi", () => ({
  getWorkout: vi.fn(),
}))

import { getWorkout } from "../lib/workoutsApi"
import { WorkoutDetail } from "../components/WorkoutDetail"
import type { WorkoutLog } from "../types"

const exercise = {
  id: "e1",
  slug: "barbell-squat",
  name: "Barbell Squat",
  category: "strength",
  equipment: "barbell",
  primary_muscles: ["quadriceps"],
  secondary_muscles: [],
  image_urls: [],
  youtube_id: null,
  is_cv_supported: true,
  instructions: [],
}

const workout: WorkoutLog = {
  id: "w1",
  title: "Leg day",
  notes: null,
  started_at: "2026-07-01T10:00:00Z",
  ended_at: "2026-07-01T11:00:00Z",
  exercises: [
    {
      id: "le1",
      exercise_id: "e1",
      order: 0,
      exercise,
      sets: [
        {
          id: "s1",
          set_number: 1,
          weight_kg: 100,
          reps: 5,
          rpe: null,
          is_warmup: false,
          completed: true,
          form_score: 87.4,
          source_session_id: "sess-1",
        },
        {
          id: "s2",
          set_number: 2,
          weight_kg: 100,
          reps: 5,
          rpe: null,
          is_warmup: true,
          completed: true,
          form_score: null,
          source_session_id: null,
        },
      ],
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.removeItem("pc.units")
})

describe("WorkoutDetail", () => {
  it("renders exercises, sets, and the total volume", async () => {
    vi.mocked(getWorkout).mockResolvedValueOnce(workout)
    render(<WorkoutDetail workoutId="w1" onBack={vi.fn()} />)

    expect(await screen.findByText("Barbell Squat")).toBeInTheDocument()
    expect(screen.getByText("Leg day")).toBeInTheDocument()
    // 2 sets × 100 kg × 5 reps = 1,000 kg total volume.
    expect(screen.getByText(/1,000 kg total volume/)).toBeInTheDocument()
    expect(screen.getByText("warm-up")).toBeInTheDocument()
  })

  it("shows a form-score badge only on CV-linked sets", async () => {
    vi.mocked(getWorkout).mockResolvedValueOnce(workout)
    render(<WorkoutDetail workoutId="w1" onBack={vi.fn()} />)

    const badge = await screen.findByTestId("detail-form-badge-s1")
    expect(badge).toHaveTextContent("87")
    expect(screen.queryByTestId("detail-form-badge-s2")).not.toBeInTheDocument()
  })

  it("shows an error message when the workout cannot load", async () => {
    vi.mocked(getWorkout).mockRejectedValueOnce(new Error("404"))
    render(<WorkoutDetail workoutId="gone" onBack={vi.fn()} />)
    expect(await screen.findByText("Couldn't load this workout.")).toBeInTheDocument()
  })
})
