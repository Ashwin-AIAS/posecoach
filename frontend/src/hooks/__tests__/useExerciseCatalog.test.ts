import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../lib/workoutsApi", () => ({
  listExercises: vi.fn(),
}))

import { listExercises } from "../../lib/workoutsApi"
import { UnauthenticatedError } from "../../lib/api"
import { useExerciseCatalog } from "../useExerciseCatalog"
import type { ExerciseSummary } from "../../types"

const CACHE_KEY = "pc.catalog.v1"

const FIXTURE: ExerciseSummary[] = [
  {
    id: "1",
    slug: "barbell-squat",
    name: "Barbell Squat",
    category: "strength",
    equipment: "barbell",
    primary_muscles: ["quadriceps"],
    secondary_muscles: [],
    image_urls: [],
    youtube_id: null,
    is_cv_supported: true,
  },
]

beforeEach(() => {
  vi.resetAllMocks()
  window.localStorage.removeItem(CACHE_KEY)
})

describe("useExerciseCatalog — P29 error/retry", () => {
  it("no cache + a 401 fetch sets error='auth' and leaves the catalog empty", async () => {
    vi.mocked(listExercises).mockRejectedValueOnce(new UnauthenticatedError("Sign in required"))
    const { result } = renderHook(() => useExerciseCatalog())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe("auth")
    expect(result.current.all).toHaveLength(0)
  })

  it("no cache + a network failure sets error='error'", async () => {
    vi.mocked(listExercises).mockRejectedValueOnce(new TypeError("Failed to fetch"))
    const { result } = renderHook(() => useExerciseCatalog())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe("error")
  })

  it("retry() re-runs the fetch and clears the error on success", async () => {
    vi.mocked(listExercises)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(FIXTURE)
    const { result } = renderHook(() => useExerciseCatalog())

    await waitFor(() => expect(result.current.error).toBe("error"))

    act(() => {
      result.current.retry()
    })

    await waitFor(() => expect(result.current.all).toHaveLength(1))
    expect(result.current.error).toBeNull()
  })

  it("a background-refresh failure behind an existing cache stays silent (error null)", async () => {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(FIXTURE))
    vi.mocked(listExercises).mockRejectedValueOnce(new UnauthenticatedError("Sign in required"))
    const { result } = renderHook(() => useExerciseCatalog())

    // Cache hit → not loading, catalog present immediately.
    expect(result.current.loading).toBe(false)
    expect(result.current.all).toHaveLength(1)

    await waitFor(() => expect(vi.mocked(listExercises)).toHaveBeenCalled())
    // The background refresh's rejection never surfaces — the cached catalog stands.
    expect(result.current.error).toBeNull()
    expect(result.current.all).toHaveLength(1)
  })
})
