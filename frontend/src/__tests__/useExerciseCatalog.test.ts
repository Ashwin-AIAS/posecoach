import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/workoutsApi", () => ({
  listExercises: vi.fn(),
}))

import { listExercises } from "../lib/workoutsApi"
import type { ExerciseSummary } from "../types"
import { useExerciseCatalog } from "../hooks/useExerciseCatalog"

const mockList = vi.mocked(listExercises)

const FIXTURE: ExerciseSummary[] = [
  {
    id: "1",
    slug: "barbell-squat",
    name: "Barbell Squat",
    category: "strength",
    equipment: "barbell",
    primary_muscles: ["quadriceps"],
    secondary_muscles: ["glutes"],
    image_urls: [],
    youtube_id: "CWl0apMgshk",
    is_cv_supported: true,
  },
  {
    id: "2",
    slug: "3-4-sit-up",
    name: "3/4 Sit-Up",
    category: "strength",
    equipment: "body only",
    primary_muscles: ["abdominals"],
    secondary_muscles: [],
    image_urls: [],
    youtube_id: null,
    is_cv_supported: false,
  },
  {
    id: "3",
    slug: "cable-deadlifts",
    name: "Cable Deadlifts",
    category: "strength",
    equipment: "cable",
    primary_muscles: ["glutes"],
    secondary_muscles: ["hamstrings"],
    image_urls: [],
    youtube_id: null,
    is_cv_supported: false,
  },
]

beforeEach(() => {
  vi.resetAllMocks()  // clears implementation queue, not just call counts
  window.localStorage.removeItem("pc.catalog.v1")
  // Default: first call returns full fixture (< PAGE_SIZE → breaks after one call).
  mockList.mockResolvedValue(FIXTURE)
})

describe("useExerciseCatalog", () => {
  it("fetches all pages and exposes the catalog", async () => {
    const { result } = renderHook(() => useExerciseCatalog())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.all).toHaveLength(3)
  })

  it("search by name returns matching rows", async () => {
    const { result } = renderHook(() => useExerciseCatalog())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const hits = result.current.search("squat")
    expect(hits).toHaveLength(1)
    expect(hits[0].slug).toBe("barbell-squat")
  })

  it("search is case-insensitive", async () => {
    const { result } = renderHook(() => useExerciseCatalog())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.search("SQUAT")).toHaveLength(1)
  })

  it("filter by equipment narrows results", async () => {
    const { result } = renderHook(() => useExerciseCatalog())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const hits = result.current.search("", { equipment: "cable" })
    expect(hits).toHaveLength(1)
    expect(hits[0].slug).toBe("cable-deadlifts")
  })

  it("filter by muscle narrows results", async () => {
    const { result } = renderHook(() => useExerciseCatalog())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const hits = result.current.search("", { muscle: "abdominals" })
    expect(hits).toHaveLength(1)
    expect(hits[0].slug).toBe("3-4-sit-up")
  })

  it("empty search with no filters returns all rows", async () => {
    const { result } = renderHook(() => useExerciseCatalog())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.search("")).toHaveLength(3)
  })

  it("returns cached results on second mount (loading false immediately)", async () => {
    // Pre-populate localStorage so the second hook mount hits the cache path.
    window.localStorage.setItem("pc.catalog.v1", JSON.stringify(FIXTURE))

    // Reset mocks — second mount should not block on fetch.
    vi.resetAllMocks()
    mockList.mockResolvedValue([])

    const { result } = renderHook(() => useExerciseCatalog())

    // Cache hit: loading is false and data is available synchronously.
    expect(result.current.loading).toBe(false)
    expect(result.current.all).toHaveLength(3)
  })
})
