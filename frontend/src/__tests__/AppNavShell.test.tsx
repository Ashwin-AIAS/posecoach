import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import App from "../App"

// Same mocks as App.test.tsx — the nav-shell cases live in their own file so
// the existing App.test.tsx stays byte-for-byte unchanged (P23: App.tsx is the
// only existing file this prompt edits).
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>()
  return {
    ...actual,
    apiJson: vi.fn(async (path: string) => {
      if (path === "/api/v1/auth/me") throw new Error("unauthenticated")
      if (path === "/api/v1/history/sessions") return []
      throw new Error(`unexpected path: ${path}`)
    }),
    apiFetch: vi.fn(),
    fetchRecommendation: vi.fn(async () => null),
  }
})

// Stub the workouts API so WorkoutPanel doesn't try to hit the network.
vi.mock("../lib/workoutsApi", () => ({
  listWorkouts: vi.fn(async () => []),
  createWorkout: vi.fn(async () => ({ id: "w1", exercises: [], started_at: new Date().toISOString(), ended_at: null, title: null, notes: null })),
  listExercises: vi.fn(async () => []),
  getExercise: vi.fn(async () => null),
  updateWorkout: vi.fn(async () => ({})),
  addExercise: vi.fn(async () => ({})),
  addSet: vi.fn(async () => ({})),
  updateSet: vi.fn(async () => ({})),
  deleteSet: vi.fn(async () => undefined),
  getWorkout: vi.fn(async () => ({})),
  listRoutines: vi.fn(async () => []),
  createRoutine: vi.fn(async () => ({})),
  deleteRoutine: vi.fn(async () => undefined),
  startFromRoutine: vi.fn(async () => ({})),
  cvLink: vi.fn(async () => ({})),
  getExerciseHistory: vi.fn(async () => ({ entries: [] })),
}))

vi.mock("../hooks/useCamera", () => ({
  useCamera: () => ({
    videoRef: { current: null },
    ready: false,
    error: null,
    facingMode: "user",
    stop: vi.fn(),
    start: vi.fn(async () => {}),
    flip: vi.fn(),
  }),
}))

vi.mock("../hooks/usePoseStream", () => ({
  usePoseStream: () => ({ result: null, error: null, connectionState: "idle" }),
}))

describe("App (P23 navigation shell)", () => {
  it("starts on the Coach tab with Home and the tab bar visible", async () => {
    render(<App />)

    await waitFor(() => expect(screen.getByTestId("home-view")).toBeInTheDocument())
    expect(screen.getByTestId("tab-bar")).toBeInTheDocument()
    expect(screen.getByTestId("tab-coach")).toHaveAttribute("aria-selected", "true")
  })

  it("switches to the Workouts tab, swapping Coach for the placeholder and back", async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByTestId("home-view")).toBeInTheDocument())

    fireEvent.click(screen.getByTestId("tab-workouts"))

    expect(screen.queryByTestId("home-view")).not.toBeInTheDocument()
    expect(screen.getByTestId("workout-panel")).toBeInTheDocument()
    expect(screen.getByTestId("tab-workouts")).toHaveAttribute("aria-selected", "true")

    // Returning to Coach restores the unchanged Home experience.
    fireEvent.click(screen.getByTestId("tab-coach"))
    expect(screen.getByTestId("home-view")).toBeInTheDocument()
  })

  it("hides the tab bar during a live set for the immersive camera view", async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByTestId("home-view")).toBeInTheDocument())

    fireEvent.click(screen.getByTestId("start-workout-btn"))

    expect(screen.getByTestId("back-home-btn")).toBeInTheDocument()
    expect(screen.queryByTestId("tab-bar")).not.toBeInTheDocument()
  })
})
