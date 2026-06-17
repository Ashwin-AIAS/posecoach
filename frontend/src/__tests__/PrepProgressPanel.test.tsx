import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { PrepProgressPanel } from "../components/PrepProgressPanel"
import { createPrep, fetchPrepProgress, fetchPreps } from "../lib/api"
import type { PrepCycle, PrepProgress } from "../types"

vi.mock("../lib/api", () => ({
  fetchPreps: vi.fn(),
  fetchPrepProgress: vi.fn(),
  createPrep: vi.fn(),
}))

const mockFetchPreps = vi.mocked(fetchPreps)
const mockFetchProgress = vi.mocked(fetchPrepProgress)
const mockCreatePrep = vi.mocked(createPrep)

const PREP: PrepCycle = {
  id: "prep-1",
  name: "Nationals",
  show_date: "2026-09-01",
  created_at: "2026-06-01T10:00:00Z",
  weeks_out: 8,
}

const PROGRESS: PrepProgress = {
  prep_id: "prep-1",
  name: "Nationals",
  show_date: "2026-09-01",
  weeks_out: 8,
  poses: [
    {
      pose: "front_double_biceps",
      label: "Front Double Biceps",
      focus_cue: "Lift both elbows higher",
      points: [
        { session_id: "a", started_at: "2026-06-01T10:00:00Z", weeks_out: 10, avg_score: 80, symmetry: 72, steadiness: 65 },
        { session_id: "b", started_at: "2026-06-08T10:00:00Z", weeks_out: 9, avg_score: 88, symmetry: 84, steadiness: 80 },
      ],
    },
  ],
}

describe("PrepProgressPanel", () => {
  beforeEach(() => {
    mockFetchPreps.mockReset()
    mockFetchProgress.mockReset()
    mockCreatePrep.mockReset()
  })

  it("renders per-pose symmetry, steadiness, the trend chart, and the fix-next cue", async () => {
    mockFetchPreps.mockResolvedValueOnce([PREP])
    mockFetchProgress.mockResolvedValueOnce(PROGRESS)

    render(<PrepProgressPanel onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByTestId("prep-pose-card")).toBeInTheDocument())
    expect(screen.getByText("Front Double Biceps")).toBeInTheDocument()
    expect(screen.getByTestId("pose-trend-chart")).toBeInTheDocument()
    expect(screen.getByTestId("prep-focus-cue")).toHaveTextContent("Lift both elbows higher")
    expect(screen.getByTestId("prep-countdown")).toHaveTextContent("8 weeks out")
  })

  it("shows the empty state when a prep has no tagged rehearsals", async () => {
    mockFetchPreps.mockResolvedValueOnce([PREP])
    mockFetchProgress.mockResolvedValueOnce({ ...PROGRESS, poses: [] })

    render(<PrepProgressPanel onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByTestId("prep-empty")).toBeInTheDocument())
  })

  it("prompts sign-in when preps are unauthorized", async () => {
    mockFetchPreps.mockRejectedValueOnce(new Error("Request failed (401)"))

    render(<PrepProgressPanel onClose={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText(/sign in to create a prep/i)).toBeInTheDocument(),
    )
  })

  it("creates a new prep from the form", async () => {
    mockFetchPreps.mockResolvedValueOnce([])
    mockCreatePrep.mockResolvedValueOnce(PREP)
    mockFetchProgress.mockResolvedValueOnce(PROGRESS)

    render(<PrepProgressPanel onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByTestId("new-prep-form")).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText("Prep name"), { target: { value: "Nationals" } })
    fireEvent.submit(screen.getByTestId("new-prep-form"))

    await waitFor(() => expect(mockCreatePrep).toHaveBeenCalledWith("Nationals", null))
  })
})
