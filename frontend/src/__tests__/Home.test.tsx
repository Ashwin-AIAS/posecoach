import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { Home } from "../components/Home"

const sessions = [
  { id: "s2", exercise: "bench", rep_count: 6, avg_form_score: 90, started_at: new Date().toISOString(), ended_at: null },
  { id: "s1", exercise: "squat", rep_count: 8, avg_form_score: 80, started_at: "2026-06-10T10:00:00Z", ended_at: null },
]

vi.mock("../lib/api", () => ({
  apiJson: vi.fn(async () => sessions),
  fetchRecommendation: vi.fn(async () => null),
}))

beforeEach(async () => {
  const { apiJson, fetchRecommendation } = await import("../lib/api")
  vi.mocked(apiJson).mockResolvedValue(sessions)
  vi.mocked(fetchRecommendation).mockResolvedValue(null)
})

describe("Home (UI-07 + P36 C1–C3)", () => {
  it("renders Today hero, stat row with StatTile, week strip, and recent sessions", async () => {
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
    expect(screen.getByTestId("today-hero-card")).toBeInTheDocument()
    expect(screen.getByTestId("week-strip")).toBeInTheDocument()
    expect(screen.getByTestId("stat-sessions")).toBeInTheDocument()
    expect(screen.getByTestId("stat-streak")).toBeInTheDocument()
    expect(screen.getAllByTestId("recent-strip-item")).toHaveLength(2)

    fireEvent.click(screen.getByTestId("start-workout-btn"))
    expect(onStart).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getAllByTestId("recent-strip-item")[0])
    expect(onShowHistory).toHaveBeenCalledTimes(1)
  })

  it("shows recommendation details on the Today card when available", async () => {
    const { fetchRecommendation } = await import("../lib/api")
    vi.mocked(fetchRecommendation).mockResolvedValueOnce({
      exercise: "squat",
      rep_target_delta: 1,
      focus_joint: "left_knee_angle",
      message: "Add 1 rep; keep knees tracking out",
    })

    render(
      <Home
        user={{ id: "u1", email: "ash@example.com", created_at: "2026-01-01T00:00:00Z" }}
        lastExercise="squat"
        onStart={vi.fn()}
        onShowHistory={vi.fn()}
      />,
    )

    await waitFor(() =>
      expect(screen.getByText("Add 1 rep; keep knees tracking out")).toBeInTheDocument(),
    )
    expect(screen.getByTestId("today-hero-card")).toHaveTextContent("Squat · +1 rep · focus: l knee")
  })

  it("handles the cold-start (204 recommendation) and signed-out state gracefully", async () => {
    const { apiJson } = await import("../lib/api")
    vi.mocked(apiJson).mockRejectedValueOnce(new Error("unauthenticated"))

    render(
      <Home user={null} lastExercise="squat" onStart={vi.fn()} onShowHistory={vi.fn()} />,
    )

    await waitFor(() =>
      expect(screen.getByText("Sign in to track your progress over time.")).toBeInTheDocument(),
    )
    expect(screen.getByTestId("today-hero-card")).toHaveTextContent("Start with Squat")
    expect(screen.queryByTestId("recent-strip-item")).not.toBeInTheDocument()
    expect(screen.getByTestId("start-workout-btn")).toBeInTheDocument()
  })

  it("renders insight cards and invokes onAskCoach with the insight prompt", async () => {
    const onAskCoach = vi.fn()
    render(
      <Home
        user={{ id: "u1", email: "ash@example.com", created_at: "2026-01-01T00:00:00Z" }}
        lastExercise="squat"
        onStart={vi.fn()}
        onShowHistory={vi.fn()}
        onAskCoach={onAskCoach}
      />,
    )

    const askBtns = await screen.findAllByTestId("insight-ask-coach")
    expect(askBtns.length).toBeGreaterThan(0)
    fireEvent.click(askBtns[0])
    expect(onAskCoach).toHaveBeenCalledTimes(1)
    expect(typeof onAskCoach.mock.calls[0][0]).toBe("string")
  })
})
