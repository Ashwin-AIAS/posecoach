import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { Home } from "../components/Home"

const sessions = [
  { id: "s2", exercise: "bench", rep_count: 6, avg_form_score: 90, started_at: new Date().toISOString(), ended_at: null },
  { id: "s1", exercise: "squat", rep_count: 8, avg_form_score: 80, started_at: "2026-06-10T10:00:00Z", ended_at: null },
]

vi.mock("../lib/api", () => ({
  apiJson: vi.fn(async () => sessions),
}))

describe("Home (UI-07)", () => {
  it("renders snapshot rings, the start CTA, and a recent-sessions strip", async () => {
    const onStart = vi.fn()
    const onShowHistory = vi.fn()
    render(
      <Home
        user={{ id: "u1", email: "ash@example.com", created_at: "2026-01-01T00:00:00Z" }}
        lastExercise="squat"
        onStart={onStart}
        onShowHistory={onShowHistory}
      />,
    )

    await waitFor(() => expect(screen.getByTestId("home-rings")).toBeInTheDocument())
    expect(screen.getAllByTestId("recent-strip-item")).toHaveLength(2)

    fireEvent.click(screen.getByTestId("start-workout-btn"))
    expect(onStart).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getAllByTestId("recent-strip-item")[0])
    expect(onShowHistory).toHaveBeenCalledTimes(1)
  })

  it("handles the signed-out / empty-history state gracefully", async () => {
    const { apiJson } = await import("../lib/api")
    vi.mocked(apiJson).mockRejectedValueOnce(new Error("unauthenticated"))

    render(
      <Home user={null} lastExercise="squat" onStart={vi.fn()} onShowHistory={vi.fn()} />,
    )

    await waitFor(() =>
      expect(screen.getByText("Sign in to track your progress over time.")).toBeInTheDocument(),
    )
    expect(screen.queryByTestId("recent-strip-item")).not.toBeInTheDocument()
    expect(screen.getByTestId("start-workout-btn")).toBeInTheDocument()
  })
})
