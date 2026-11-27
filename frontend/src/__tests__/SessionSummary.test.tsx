import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SessionSummary } from "../components/SessionSummary"
import { apiJson, submitEffort } from "../lib/api"
import type { SessionStats } from "../hooks/useSessionStats"

vi.mock("../lib/api", () => ({ apiJson: vi.fn(), submitEffort: vi.fn() }))
const mockApiJson = vi.mocked(apiJson)
const mockSubmitEffort = vi.mocked(submitEffort)

const stats: SessionStats = {
  reps: 9,
  avgScore: 84.4,
  bestScore: 96,
  samples: 120,
  repScores: [],
  holdSeries: [],
}

describe("SessionSummary", () => {
  beforeEach(() => {
    mockApiJson.mockReset()
    mockSubmitEffort.mockReset()
  })

  it("shows this session's reps, avg, and best", async () => {
    mockApiJson.mockResolvedValueOnce([])
    render(<SessionSummary exercise="squat" stats={stats} onClose={vi.fn()} />)
    expect(screen.getByText("9")).toBeInTheDocument() // reps
    expect(screen.getByText("84")).toBeInTheDocument() // avg score rounded
    expect(screen.getByText("96")).toBeInTheDocument() // best
  })

  it("prompts sign-in when history is unauthorized", async () => {
    mockApiJson.mockRejectedValueOnce(new Error("Request failed (401)"))
    render(<SessionSummary exercise="curl" stats={stats} onClose={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText(/sign in to track your progress/i)).toBeInTheDocument(),
    )
  })

  it("renders a trend sparkline when history has enough sessions", async () => {
    mockApiJson.mockResolvedValueOnce([
      { id: "1", avg_form_score: 70, started_at: "2026-05-01T10:00:00Z" },
      { id: "2", avg_form_score: 78, started_at: "2026-05-02T10:00:00Z" },
      { id: "3", avg_form_score: 85, started_at: "2026-05-03T10:00:00Z" },
    ])
    render(<SessionSummary exercise="bench" stats={stats} onClose={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByRole("img", { name: /average score trend/i })).toBeInTheDocument(),
    )
  })

  it("tapping an effort button submits feedback and disables the buttons", async () => {
    mockApiJson.mockResolvedValueOnce([
      { id: "s1", exercise: "squat", avg_form_score: 84, started_at: "2026-06-11T10:00:00Z" },
    ])
    mockSubmitEffort.mockResolvedValueOnce(undefined)
    render(<SessionSummary exercise="squat" stats={stats} onClose={vi.fn()} />)

    const easy = await screen.findByRole("button", { name: /too easy/i })
    fireEvent.click(easy)

    expect(mockSubmitEffort).toHaveBeenCalledWith("s1", 1)
    await waitFor(() => expect(easy).toBeDisabled())
    expect(screen.getByRole("button", { name: /too hard/i })).toBeDisabled()
    // Repeat taps must not re-fire the PATCH
    fireEvent.click(screen.getByRole("button", { name: /too hard/i }))
    expect(mockSubmitEffort).toHaveBeenCalledTimes(1)
  })

  it("hides the effort question when history fetch is unauthorized", async () => {
    mockApiJson.mockRejectedValueOnce(new Error("Request failed (401)"))
    render(<SessionSummary exercise="squat" stats={stats} onClose={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText(/sign in to track your progress/i)).toBeInTheDocument(),
    )
    expect(screen.queryByTestId("effort-question")).not.toBeInTheDocument()
  })

  it("never leaks another exercise's history score into Best on a 0-rep set (B1 regression)", async () => {
    mockApiJson.mockResolvedValueOnce([
      { id: "h1", exercise: "deadlift", avg_form_score: 90, started_at: "2026-06-10T10:00:00Z" },
      { id: "h2", exercise: "bench", avg_form_score: 95, started_at: "2026-06-11T10:00:00Z" },
    ])
    const emptySet: SessionStats = {
      reps: 0,
      avgScore: 0,
      bestScore: 0,
      samples: 0,
      repScores: [],
      holdSeries: [],
    }
    render(<SessionSummary exercise="squat" stats={emptySet} onClose={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByRole("img", { name: /average score trend/i })).toBeInTheDocument(),
    )
    expect(screen.queryByText("90")).not.toBeInTheDocument()
    expect(screen.queryByText("95")).not.toBeInTheDocument()
    expect(screen.queryByTestId("personal-best")).not.toBeInTheDocument()
  })

  it("shows Best for this set only and Personal best scoped to the active exercise", async () => {
    mockApiJson.mockResolvedValueOnce([
      { id: "h1", exercise: "squat", avg_form_score: 91, started_at: "2026-06-10T10:00:00Z" },
      { id: "h2", exercise: "deadlift", avg_form_score: 98, started_at: "2026-06-11T10:00:00Z" },
    ])
    const setStats: SessionStats = {
      reps: 5,
      avgScore: 76,
      bestScore: 83,
      samples: 50,
      repScores: [72, 75, 83, 74, 76],
      holdSeries: [],
    }
    render(<SessionSummary exercise="squat" stats={setStats} onClose={vi.fn()} />)
    const pb = await screen.findByTestId("personal-best")
    expect(pb).toHaveTextContent("Personal best (Squat)")
    expect(pb).toHaveTextContent("91")
    expect(screen.getByText("83")).toBeInTheDocument()
    expect(screen.queryByText("98")).not.toBeInTheDocument()
  })

  it("renders a one-line verdict, deterministic set insights, and triggers celebration when avg >= 80 (B2)", async () => {
    mockApiJson.mockResolvedValueOnce([
      { id: "h1", exercise: "squat", avg_form_score: 75, started_at: "2026-06-10T10:00:00Z" },
    ])
    const strongSet: SessionStats = {
      reps: 6,
      avgScore: 81,
      bestScore: 88,
      samples: 90,
      repScores: [86, 88, 85, 84, 59, 57],
      holdSeries: [],
      worstJoint: "left_knee_angle",
    }
    render(<SessionSummary exercise="squat" stats={strongSet} onClose={vi.fn()} />)
    expect(screen.getByTestId("set-verdict")).toHaveTextContent("Form broke down late")
    expect(await screen.findByTestId("summary-celebration")).toBeInTheDocument()
    const items = await screen.findAllByTestId("set-insight-item")
    expect(items.map((el) => el.textContent)).toContain("Reps 5–6 dropped to 58 — fatigue?")
    expect(items.map((el) => el.textContent)).toContain("Avg 81, +6 vs your last Squat")
  })
})
