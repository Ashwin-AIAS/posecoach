import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/workoutsApi", () => ({
  listRoutines: vi.fn(async () => []),
  deleteRoutine: vi.fn(async () => undefined),
  startFromRoutine: vi.fn(async () => ({
    id: "w-new",
    title: "Push Day",
    notes: null,
    started_at: new Date().toISOString(),
    ended_at: null,
    exercises: [],
  })),
}))

import { deleteRoutine, listRoutines, startFromRoutine } from "../lib/workoutsApi"
import { UnauthenticatedError } from "../lib/api"
import { RoutineList } from "../components/RoutineList"
import type { RoutineOut } from "../types"

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
  is_cv_supported: true, is_custom: false,
  instructions: [],
}

const routine: RoutineOut = {
  id: "r1",
  name: "Push Day",
  created_at: new Date().toISOString(),
  exercises: [{ exercise_id: "e1", order: 0, exercise }],
}

beforeEach(() => vi.clearAllMocks())

describe("RoutineList", () => {
  it("renders nothing while the user has no routines", async () => {
    const { container } = render(<RoutineList onStartWorkout={vi.fn()} />)
    await waitFor(() => expect(vi.mocked(listRoutines)).toHaveBeenCalled())
    expect(container.firstChild).toBeNull()
  })

  it("lists routines with name and exercise count", async () => {
    vi.mocked(listRoutines).mockResolvedValueOnce([routine])
    render(<RoutineList onStartWorkout={vi.fn()} />)
    expect(await screen.findByText("Push Day")).toBeInTheDocument()
    expect(screen.getByText("1 exercise")).toBeInTheDocument()
  })

  it("starts a workout from a routine and hands it to the parent", async () => {
    vi.mocked(listRoutines).mockResolvedValueOnce([routine])
    const onStart = vi.fn()
    render(<RoutineList onStartWorkout={onStart} />)

    fireEvent.click(await screen.findByTestId("routine-start-r1"))
    await waitFor(() => expect(onStart).toHaveBeenCalled())
    expect(vi.mocked(startFromRoutine)).toHaveBeenCalledWith("r1")
    expect(onStart.mock.calls[0][0]).toMatchObject({ id: "w-new", title: "Push Day" })
  })

  it("deletes only after the inline confirm", async () => {
    vi.mocked(listRoutines).mockResolvedValueOnce([routine])
    render(<RoutineList onStartWorkout={vi.fn()} />)

    fireEvent.click(await screen.findByTestId("routine-delete-r1"))
    expect(vi.mocked(deleteRoutine)).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId("routine-delete-confirm-r1"))
    await waitFor(() => expect(vi.mocked(deleteRoutine)).toHaveBeenCalledWith("r1"))
    expect(screen.queryByText("Push Day")).not.toBeInTheDocument()
  })

  it("signed-out routine start shows a sign-in card that deep-links to Settings (P29)", async () => {
    vi.mocked(listRoutines).mockResolvedValueOnce([routine])
    vi.mocked(startFromRoutine).mockRejectedValueOnce(new UnauthenticatedError("Sign in required"))
    const onSignIn = vi.fn()
    render(<RoutineList onStartWorkout={vi.fn()} onSignIn={onSignIn} />)

    fireEvent.click(await screen.findByTestId("routine-start-r1"))

    expect(await screen.findByTestId("sign-in-prompt")).toHaveTextContent(
      "Sign in to start a routine",
    )
    fireEvent.click(screen.getByTestId("sign-in-prompt-btn"))
    expect(onSignIn).toHaveBeenCalled()
  })

  it("a network-fail routine start shows an error card; retry re-attempts", async () => {
    vi.mocked(listRoutines).mockResolvedValueOnce([routine])
    vi.mocked(startFromRoutine)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({
        id: "w-new",
        title: "Push Day",
        notes: null,
        started_at: new Date().toISOString(),
        ended_at: null,
        exercises: [],
      })
    const onStart = vi.fn()
    render(<RoutineList onStartWorkout={onStart} />)

    fireEvent.click(await screen.findByTestId("routine-start-r1"))
    expect(await screen.findByTestId("error-retry")).toHaveTextContent(/offline/i)

    fireEvent.click(screen.getByTestId("error-retry-btn"))
    await waitFor(() => expect(onStart).toHaveBeenCalled())
    expect(vi.mocked(startFromRoutine)).toHaveBeenCalledTimes(2)
  })
})
