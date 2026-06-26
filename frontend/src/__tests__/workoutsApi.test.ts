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
  createWorkout,
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
