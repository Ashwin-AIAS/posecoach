import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { HistoryTrend } from "../components/HistoryTrend"
import type { TrendSession } from "../components/HistoryTrend"

const sessions: TrendSession[] = [
  { exercise: "squat", avg_form_score: 70, started_at: "2026-05-01T10:00:00Z" },
  { exercise: "squat", avg_form_score: 82, started_at: "2026-05-02T10:00:00Z" },
  { exercise: "squat", avg_form_score: 88, started_at: "2026-05-03T10:00:00Z" },
  { exercise: "bench", avg_form_score: 60, started_at: "2026-05-02T10:00:00Z" },
]

describe("HistoryTrend", () => {
  it("renders one point per session for the default (first present) exercise", () => {
    render(<HistoryTrend sessions={sessions} />)
    // Default exercise = squat (first seen) → 3 sessions → 3 points.
    expect(screen.getAllByTestId("trend-point")).toHaveLength(3)
  })

  it("renders a friendly hint and no chart when there is no history", () => {
    render(<HistoryTrend sessions={[]} />)
    expect(screen.queryByTestId("trend-point")).toBeNull()
    expect(screen.getByText(/train a few sessions/i)).toBeInTheDocument()
  })

  it("re-plots when the exercise filter changes", () => {
    render(<HistoryTrend sessions={sessions} />)
    fireEvent.change(screen.getByLabelText(/filter by exercise/i), {
      target: { value: "bench" },
    })
    expect(screen.getAllByTestId("trend-point")).toHaveLength(1)
  })

  it("handles a single data point without a broken axis", () => {
    render(
      <HistoryTrend
        sessions={[{ exercise: "plank", avg_form_score: 91, started_at: "2026-05-01T10:00:00Z" }]}
      />,
    )
    expect(screen.getAllByTestId("trend-point")).toHaveLength(1)
    // A single point renders a dot but no connecting polyline.
    expect(document.querySelector("polyline")).toBeNull()
  })
})
