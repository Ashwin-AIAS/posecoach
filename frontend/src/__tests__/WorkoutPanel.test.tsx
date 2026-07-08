import { fireEvent, render, screen, waitFor } from "@testing-library/react"
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
  getWorkout: vi.fn(async () => ({
    id: "w-resume",
    title: "Leg day",
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
  listRoutines: vi.fn(async () => []),
  createRoutine: vi.fn(async () => ({})),
  deleteRoutine: vi.fn(async () => undefined),
  startFromRoutine: vi.fn(async () => ({})),
  cvLink: vi.fn(async () => ({})),
  getExerciseHistory: vi.fn(async () => ({ entries: [] })),
}))

import { getWorkout } from "../lib/workoutsApi"
import { WorkoutPanel } from "../components/WorkoutPanel"

const ACTIVE_KEY = "pc.activeWorkout.v1"

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.removeItem("pc.catalog.v1")
  window.localStorage.removeItem(ACTIVE_KEY)
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

  it("hides the resume button when no active workout is stored", async () => {
    render(<WorkoutPanel />)
    await waitFor(() => expect(screen.getByTestId("start-workout-cta")).toBeInTheDocument())
    expect(screen.queryByTestId("resume-workout-btn")).not.toBeInTheDocument()
  })

  it("offers Resume workout when an active id is stored, and resumes into it", async () => {
    window.localStorage.setItem(ACTIVE_KEY, "w-resume")
    render(<WorkoutPanel />)
    const resume = await screen.findByTestId("resume-workout-btn")

    fireEvent.click(resume)
    await waitFor(() => expect(screen.getByTestId("active-workout")).toBeInTheDocument())
    expect(vi.mocked(getWorkout)).toHaveBeenCalledWith("w-resume")
    expect(screen.getByText("Leg day")).toBeInTheDocument()
  })

  it("clears a stale pointer when the stored workout is already finished", async () => {
    vi.mocked(getWorkout).mockResolvedValueOnce({
      id: "w-resume",
      title: "Old",
      notes: null,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      exercises: [],
    })
    window.localStorage.setItem(ACTIVE_KEY, "w-resume")
    render(<WorkoutPanel />)

    fireEvent.click(await screen.findByTestId("resume-workout-btn"))
    await waitFor(() =>
      expect(screen.queryByTestId("resume-workout-btn")).not.toBeInTheDocument(),
    )
    expect(window.localStorage.getItem(ACTIVE_KEY)).toBeNull()
    // Still on the landing — nothing to resume.
    expect(screen.getByTestId("start-workout-cta")).toBeInTheDocument()
  })

  it("persists the active workout id when starting a workout", async () => {
    render(<WorkoutPanel />)
    fireEvent.click(await screen.findByTestId("start-workout-cta"))
    await waitFor(() => expect(screen.getByTestId("active-workout")).toBeInTheDocument())
    expect(window.localStorage.getItem(ACTIVE_KEY)).toBe("w1")
  })
})
