import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock the underlying api module before importing workoutsApi.
vi.mock("../lib/api", () => ({
  apiJson: vi.fn(),
  apiFetch: vi.fn(),
}))

import { apiJson } from "../lib/api"
import {
  listExercises,
  getExercise,
  getWorkout,
  createWorkout,
  createRoutine,
  cvLink,
  deleteRoutine,
  listRoutines,
  startFromRoutine,
  addSet,
} from "../lib/workoutsApi"

const mockApiJson = vi.mocked(apiJson)

beforeEach(() => vi.clearAllMocks())

describe("listExercises", () => {
  it("calls the catalog endpoint with no params", async () => {
    mockApiJson.mockResolvedValueOnce([])
    await listExercises()
    expect(mockApiJson).toHaveBeenCalledWith("/api/v1/workouts/exercises")
  })

  it("appends query params when provided", async () => {
    mockApiJson.mockResolvedValueOnce([])
    await listExercises({ search: "squat", limit: 50, offset: 0 })
    const url = mockApiJson.mock.calls[0][0] as string
    expect(url).toContain("search=squat")
    expect(url).toContain("limit=50")
    expect(url).toContain("offset=0")
  })
})

describe("getExercise", () => {
  it("calls the exercise detail endpoint", async () => {
    mockApiJson.mockResolvedValueOnce({})
    await getExercise("barbell-squat")
    expect(mockApiJson).toHaveBeenCalledWith("/api/v1/workouts/exercises/barbell-squat")
  })
})

describe("createWorkout", () => {
  it("POSTs to the workouts endpoint", async () => {
    mockApiJson.mockResolvedValueOnce({ id: "w1", exercises: [] })
    await createWorkout("Push Day")
    expect(mockApiJson).toHaveBeenCalledWith(
      "/api/v1/workouts/workouts",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("defaults the title — the API rejects a null title with 422", async () => {
    mockApiJson.mockResolvedValueOnce({ id: "w1", exercises: [] })
    await createWorkout()
    const body = JSON.parse(
      (mockApiJson.mock.calls[0][1] as RequestInit).body as string,
    ) as Record<string, unknown>
    expect(typeof body.title).toBe("string")
    expect((body.title as string).length).toBeGreaterThan(0)
  })
})

describe("getWorkout", () => {
  it("GETs one workout by id", async () => {
    mockApiJson.mockResolvedValueOnce({ id: "w1", exercises: [] })
    await getWorkout("w1")
    expect(mockApiJson).toHaveBeenCalledWith("/api/v1/workouts/workouts/w1")
  })
})

describe("cvLink", () => {
  it("POSTs only the session id — the score is server-side", async () => {
    mockApiJson.mockResolvedValueOnce({ id: "s1", session_rep_count: 8 })
    await cvLink("s1", "sess-9")
    expect(mockApiJson).toHaveBeenCalledWith(
      "/api/v1/workouts/sets/s1/cv-link",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(
      (mockApiJson.mock.calls[0][1] as RequestInit).body as string,
    ) as Record<string, unknown>
    expect(body).toEqual({ session_id: "sess-9" })
  })

  it("detaches with a null session id", async () => {
    mockApiJson.mockResolvedValueOnce({ id: "s1", session_rep_count: null })
    await cvLink("s1", null)
    const body = JSON.parse(
      (mockApiJson.mock.calls[0][1] as RequestInit).body as string,
    ) as Record<string, unknown>
    expect(body).toEqual({ session_id: null })
  })
})

describe("routines", () => {
  it("lists, creates, deletes, and starts from a routine", async () => {
    mockApiJson.mockResolvedValue({})
    await listRoutines()
    expect(mockApiJson).toHaveBeenCalledWith("/api/v1/workouts/routines")

    await createRoutine("Push Day", ["e1", "e2"])
    expect(mockApiJson).toHaveBeenCalledWith(
      "/api/v1/workouts/routines",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(
      (mockApiJson.mock.calls[1][1] as RequestInit).body as string,
    ) as Record<string, unknown>
    expect(body).toEqual({ name: "Push Day", exercise_ids: ["e1", "e2"] })

    await deleteRoutine("r1")
    expect(mockApiJson).toHaveBeenCalledWith(
      "/api/v1/workouts/routines/r1",
      expect.objectContaining({ method: "DELETE" }),
    )

    await startFromRoutine("r1")
    expect(mockApiJson).toHaveBeenCalledWith(
      "/api/v1/workouts/workouts/from-routine/r1",
      expect.objectContaining({ method: "POST" }),
    )
  })
})

describe("addSet", () => {
  it("POSTs to the sets endpoint with the correct body", async () => {
    mockApiJson.mockResolvedValueOnce({ id: "s1" })
    await addSet("le1", { weight_kg: 100, reps: 8 })
    expect(mockApiJson).toHaveBeenCalledWith(
      "/api/v1/workouts/logged-exercises/le1/sets",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(
      (mockApiJson.mock.calls[0][1] as RequestInit).body as string,
    ) as Record<string, unknown>
    expect(body.weight_kg).toBe(100)
    expect(body.reps).toBe(8)
  })
})
