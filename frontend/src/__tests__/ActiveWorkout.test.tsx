import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/workoutsApi", () => ({
  addExercise: vi.fn(async (_workoutId: string, exerciseId: string) => ({
    id: "le1",
    exercise_id: exerciseId,
    order: 0,
    exercise: {
      id: exerciseId,
      slug: "barbell-squat",
      name: "Barbell Squat",
      category: "strength",
      equipment: "barbell",
      primary_muscles: ["quadriceps"],
      secondary_muscles: [],
      instructions: [],
      image_urls: [],
      youtube_id: null,
      is_cv_supported: false,
    },
    sets: [],
  })),
  addSet: vi.fn(async () => ({
    id: "s1",
    set_number: 1,
    weight_kg: 100,
    reps: 8,
    rpe: null,
    is_warmup: false,
    completed: true,
    form_score: null,
    source_session_id: null,
  })),
  listExercises: vi.fn(async () => [
    {
      id: "ex1",
      slug: "barbell-squat",
      name: "Barbell Squat",
      category: "strength",
      equipment: "barbell",
      primary_muscles: ["quadriceps"],
      secondary_muscles: [],
      image_urls: [],
      youtube_id: null,
      is_cv_supported: false,
    },
  ]),
  getExerciseHistory: vi.fn(async () => ({
    slug: "barbell-squat",
    name: "Barbell Squat",
    total_sets: 0,
    total_volume_kg: 0,
    best_one_rep_max: 0,
    entries: [],
  })),
  updateSet: vi.fn(async () => ({})),
  deleteSet: vi.fn(async () => undefined),
}))

import { ActiveWorkout } from "../components/ActiveWorkout"
import type { LocalWorkout } from "../hooks/useWorkoutLog"

const EMPTY_WORKOUT: LocalWorkout = {
  id: "w1",
  title: "Push Day",
  notes: null,
  started_at: new Date().toISOString(),
  ended_at: null,
  exercises: [],
}

const mockWorkoutLog = {
  workout: EMPTY_WORKOUT,
  setWorkout: vi.fn(),
  logSet: vi.fn(),
  completeSet: vi.fn(),
  removeSet: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.removeItem("pc.catalog.v1")
})

describe("ActiveWorkout", () => {
  it("renders with testid and workout title", () => {
    render(
      <ActiveWorkout workout={EMPTY_WORKOUT} workoutLog={mockWorkoutLog} onFinish={vi.fn()} />,
    )
    expect(screen.getByTestId("active-workout")).toBeInTheDocument()
    expect(screen.getByText("Push Day")).toBeInTheDocument()
  })

  it("shows Add exercise button", () => {
    render(
      <ActiveWorkout workout={EMPTY_WORKOUT} workoutLog={mockWorkoutLog} onFinish={vi.fn()} />,
    )
    expect(screen.getByTestId("add-exercise-btn")).toBeInTheDocument()
  })

  it("opens the exercise picker when Add exercise is clicked", async () => {
    render(
      <ActiveWorkout workout={EMPTY_WORKOUT} workoutLog={mockWorkoutLog} onFinish={vi.fn()} />,
    )
    fireEvent.click(screen.getByTestId("add-exercise-btn"))
    await waitFor(() => expect(screen.getByTestId("exercise-picker")).toBeInTheDocument())
  })

  it("calls onFinish when Finish button is clicked", () => {
    const onFinish = vi.fn()
    render(
      <ActiveWorkout workout={EMPTY_WORKOUT} workoutLog={mockWorkoutLog} onFinish={onFinish} />,
    )
    fireEvent.click(screen.getByTestId("finish-workout-btn"))
    expect(onFinish).toHaveBeenCalledOnce()
  })

  it("calls logSet when a set is submitted via SetRow", () => {
    const workoutWithExercise: LocalWorkout = {
      ...EMPTY_WORKOUT,
      exercises: [
        {
          id: "le1",
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
            is_cv_supported: false,
          },
          sets: [],
        },
      ],
    }

    const mockLog = { ...mockWorkoutLog }
    render(
      <ActiveWorkout workout={workoutWithExercise} workoutLog={mockLog} onFinish={vi.fn()} />,
    )

    // Expand the exercise section.
    fireEvent.click(screen.getByTestId("exercise-section-le1"))

    // Fill and submit a set.
    fireEvent.change(screen.getByTestId("weight-input-1"), { target: { value: "100" } })
    fireEvent.change(screen.getByTestId("reps-input-1"), { target: { value: "8" } })
    fireEvent.click(screen.getByTestId("log-set-btn-1"))

    expect(mockLog.logSet).toHaveBeenCalledWith("le1", 100, 8, undefined)
  })
})
