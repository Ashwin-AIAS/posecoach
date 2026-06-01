import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SessionSummary } from "../components/SessionSummary"
import { apiJson } from "../lib/api"
import type { SessionStats } from "../hooks/useSessionStats"

vi.mock("../lib/api", () => ({ apiJson: vi.fn() }))
const mockApiJson = vi.mocked(apiJson)

const stats: SessionStats = {
  reps: 9,
  avgScore: 84.4,
  bestScore: 96,
  samples: 120,
  repScores: [],
  holdSeries: [],
}

describe("SessionSummary", () => {
  beforeEach(() => mockApiJson.mockReset())

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
})
