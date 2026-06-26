import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/workoutsApi", () => ({
  listWorkouts: vi.fn(async () => []),
  createWorkout: vi.fn(async () => ({
    id: "w1",
    title: null,
    notes: null,
    started_at: new Date().toISOString(),
    ended_at: null,
    exercises: [],
  })),
  listExercises: vi.fn(async () => []),
  getExercise: vi.fn(async () => null),
  updateWorkout: vi.fn(async () => ({})),
  addExercise: vi.fn(async () => ({})),
  addSet: vi.fn(async () => ({})),
  updateSet: vi.fn(async () => ({})),
  deleteSet: vi.fn(async () => undefined),
}))

import { WorkoutPanel } from "../components/WorkoutPanel"

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.removeItem("pc.catalog.v1")
})

describe("WorkoutPanel", () => {
  it("renders the landing view with the workout panel testid", async () => {
    render(<WorkoutPanel />)
    await waitFor(() => expect(screen.getByTestId("workout-panel")).toBeInTheDocument())
  })

  it("shows Start workout CTA button", async () => {
    render(<WorkoutPanel />)
    await waitFor(() => expect(screen.getByTestId("start-workout-cta")).toBeInTheDocument())
  })

  it("shows Browse exercises button", async () => {
    render(<WorkoutPanel />)
    await waitFor(() => expect(screen.getByTestId("browse-exercises-btn")).toBeInTheDocument())
  })

  it("shows 'No workouts logged yet' when recent list is empty", async () => {
    render(<WorkoutPanel />)
    await waitFor(() =>
      expect(screen.getByText("No workouts logged yet.")).toBeInTheDocument(),
    )
  })
})
