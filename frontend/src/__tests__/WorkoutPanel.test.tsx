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

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>()
  return {
    ...actual,
    apiJson: vi.fn(async () => []),
    apiFetch: vi.fn(),
  }
})

import { apiJson, UnauthenticatedError } from "../lib/api"
import { createWorkout, getWorkout, listWorkouts } from "../lib/workoutsApi"
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

  it("minimize returns to the landing with the workout still resumable, keeping the pointer", async () => {
    const onActiveWorkout = vi.fn()
    render(<WorkoutPanel onActiveWorkout={onActiveWorkout} />)

    fireEvent.click(await screen.findByTestId("start-workout-cta"))
    await waitFor(() => expect(screen.getByTestId("active-workout")).toBeInTheDocument())
    expect(onActiveWorkout).toHaveBeenLastCalledWith(true)

    // Minimize (not finish): back to the landing, workout still resumable.
    fireEvent.click(screen.getByTestId("minimize-workout-btn"))
    await waitFor(() => expect(screen.getByTestId("resume-workout-btn")).toBeInTheDocument())
    expect(onActiveWorkout).toHaveBeenLastCalledWith(false)
    // The pointer is kept (not cleared like finish would) so resume survives.
    expect(window.localStorage.getItem(ACTIVE_KEY)).toBe("w1")

    // And it resumes straight back into the active workout.
    fireEvent.click(screen.getByTestId("resume-workout-btn"))
    await waitFor(() => expect(screen.getByTestId("active-workout")).toBeInTheDocument())
  })

  it("resolves a returning form-check: auto-resumes, matches the session, pre-fills", async () => {
    const startedAt = new Date(Date.now() - 5 * 60_000).toISOString()
    window.localStorage.setItem(ACTIVE_KEY, "w-resume")
    vi.mocked(getWorkout).mockResolvedValueOnce({
      id: "w-resume",
      title: "Leg day",
      notes: null,
      started_at: startedAt,
      ended_at: null,
      exercises: [
        {
          id: "le-squat",
          exercise_id: "ex1",
          order: 0,
          exercise: {
            id: "ex1",
            slug: "barbell-squat",
            name: "Barbell Squat",
            category: "strength",
            equipment: "barbell",
            primary_muscles: ["quadriceps"],
            secondary_muscles: [],
            instructions: [],
            image_urls: [],
            youtube_id: null,
            is_cv_supported: true, is_custom: false,
          },
          sets: [],
        },
      ],
    })
    vi.mocked(apiJson).mockResolvedValueOnce([
      {
        id: "sess-9",
        exercise: "squat",
        session_type: "exercise",
        rep_count: 8,
        avg_form_score: 90,
        started_at: new Date().toISOString(),
      },
    ])
    const onHandled = vi.fn()

    render(
      <WorkoutPanel
        pendingFormCheck={{ loggedExerciseId: "le-squat", cvExercise: "squat", startedAt }}
        onFormCheckHandled={onHandled}
      />,
    )

    // Auto-resumes the persisted workout and lands the CV prefill on the row.
    await waitFor(() => expect(screen.getByTestId("active-workout")).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId("cv-prefill-hint")).toBeInTheDocument())
    expect(vi.mocked(apiJson)).toHaveBeenCalledWith("/api/v1/history/sessions?limit=5")
    expect(onHandled).toHaveBeenCalled()
  })

  it("fails open when no session matches a returning form-check", async () => {
    const startedAt = new Date(Date.now() - 5 * 60_000).toISOString()
    window.localStorage.setItem(ACTIVE_KEY, "w-resume")
    vi.mocked(apiJson).mockResolvedValueOnce([]) // no sessions at all
    const onHandled = vi.fn()

    render(
      <WorkoutPanel
        pendingFormCheck={{ loggedExerciseId: "le-squat", cvExercise: "squat", startedAt }}
        onFormCheckHandled={onHandled}
      />,
    )

    await waitFor(() => expect(screen.getByTestId("active-workout")).toBeInTheDocument())
    expect(screen.queryByTestId("cv-prefill-hint")).not.toBeInTheDocument()
    await waitFor(() => expect(onHandled).toHaveBeenCalled())
  })

  describe("P29 error surfacing", () => {
    it("signed-out Start workout shows a sign-in card that deep-links to Settings", async () => {
      vi.mocked(createWorkout).mockRejectedValueOnce(new UnauthenticatedError("Sign in required"))
      const onNavigateSettings = vi.fn()
      render(<WorkoutPanel onNavigateSettings={onNavigateSettings} />)

      fireEvent.click(await screen.findByTestId("start-workout-cta"))

      expect(await screen.findByTestId("sign-in-prompt")).toHaveTextContent("Sign in to track workouts")
      fireEvent.click(screen.getByTestId("sign-in-prompt-btn"))
      expect(onNavigateSettings).toHaveBeenCalled()
      // The failed click never persisted an active id.
      expect(window.localStorage.getItem(ACTIVE_KEY)).toBeNull()
    })

    it("a network-fail Start workout shows an error card; retry re-attempts the same action", async () => {
      vi.mocked(createWorkout)
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce({
          id: "w1",
          title: null,
          notes: null,
          started_at: new Date().toISOString(),
          ended_at: null,
          exercises: [],
        })
      render(<WorkoutPanel />)

      fireEvent.click(await screen.findByTestId("start-workout-cta"))
      expect(await screen.findByTestId("error-retry")).toHaveTextContent(/offline/i)

      fireEvent.click(screen.getByTestId("error-retry-btn"))
      await waitFor(() => expect(screen.getByTestId("active-workout")).toBeInTheDocument())
      expect(vi.mocked(createWorkout)).toHaveBeenCalledTimes(2)
    })

    it("signed-out Resume keeps the stored pointer (still resumable once signed in)", async () => {
      window.localStorage.setItem(ACTIVE_KEY, "w-resume")
      vi.mocked(getWorkout).mockRejectedValueOnce(new UnauthenticatedError("Sign in required"))
      render(<WorkoutPanel />)

      fireEvent.click(await screen.findByTestId("resume-workout-btn"))

      expect(await screen.findByTestId("sign-in-prompt")).toHaveTextContent(
        "Sign in to track workouts",
      )
      // resumableId untouched — the button is still there for the next attempt.
      expect(screen.getByTestId("resume-workout-btn")).toBeInTheDocument()
      expect(window.localStorage.getItem(ACTIVE_KEY)).toBe("w-resume")
    })

    it("shows a sign-in card in Recent workouts when signed out", async () => {
      vi.mocked(listWorkouts).mockRejectedValueOnce(new UnauthenticatedError("Sign in required"))
      const onNavigateSettings = vi.fn()
      render(<WorkoutPanel onNavigateSettings={onNavigateSettings} />)

      expect(await screen.findByTestId("sign-in-prompt")).toHaveTextContent(
        "Sign in to see your recent workouts",
      )
      fireEvent.click(screen.getByTestId("sign-in-prompt-btn"))
      expect(onNavigateSettings).toHaveBeenCalled()
    })

    it("selecting an exercise that 401s in the library shows a sign-in card", async () => {
      const { getExercise, listExercises } = await import("../lib/workoutsApi")
      vi.mocked(listExercises).mockResolvedValueOnce([
        {
          id: "e1",
          slug: "barbell-squat",
          name: "Barbell Squat",
          category: "strength",
          equipment: "barbell",
          primary_muscles: ["quadriceps"],
          secondary_muscles: [],
          image_urls: [],
          youtube_id: null,
          is_cv_supported: true, is_custom: false,
        },
      ])
      vi.mocked(getExercise).mockRejectedValueOnce(new UnauthenticatedError("Sign in required"))
      const onNavigateSettings = vi.fn()
      render(<WorkoutPanel onNavigateSettings={onNavigateSettings} />)

      fireEvent.click(await screen.findByTestId("browse-exercises-btn"))
      fireEvent.click(await screen.findByTestId("exercise-row-barbell-squat"))

      expect(await screen.findByTestId("sign-in-prompt")).toHaveTextContent(
        "Sign in to view this exercise",
      )
      fireEvent.click(screen.getByTestId("sign-in-prompt-btn"))
      expect(onNavigateSettings).toHaveBeenCalled()
      // Still on the library, not stuck on a dead click.
      expect(screen.getByTestId("exercise-library")).toBeInTheDocument()
    })

    it("a couldn't-load catalog in the library shows an error card with retry", async () => {
      const { listExercises } = await import("../lib/workoutsApi")
      vi.mocked(listExercises)
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce([])
      render(<WorkoutPanel />)

      fireEvent.click(await screen.findByTestId("browse-exercises-btn"))

      expect(await screen.findByTestId("error-retry")).toHaveTextContent(
        "Couldn't load the exercise catalog.",
      )
      fireEvent.click(screen.getByTestId("error-retry-btn"))
      await waitFor(() => expect(vi.mocked(listExercises)).toHaveBeenCalledTimes(2))
    })
  })
})
