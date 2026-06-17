import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { HistoryPanel } from "../components/HistoryPanel"

const sessions = [
  {
    id: "s1",
    exercise: "squat",
    session_type: "exercise",
    rep_count: 8,
    avg_form_score: 88,
    started_at: "2026-06-10T10:00:00Z",
    ended_at: "2026-06-10T10:05:00Z",
  },
  {
    id: "s2",
    exercise: "squat",
    session_type: "exercise",
    rep_count: 10,
    avg_form_score: 92,
    started_at: "2026-06-11T10:00:00Z",
    ended_at: "2026-06-11T10:05:00Z",
  },
]

const detail = {
  ...sessions[0],
  keypoints_data: { snapshots: [{ ts: 1, score: 80 }, { ts: 2, score: 90 }] },
}

vi.mock("../lib/api", () => ({
  apiFetch: vi.fn(),
  apiJson: vi.fn(async (path: string) => {
    if (path === "/api/v1/history/sessions") return sessions
    throw new Error("unexpected path")
  }),
  assignSessionPrep: vi.fn(),
  fetchPreps: vi.fn(async () => []),
  getSessionDetail: vi.fn(async () => detail),
}))

describe("HistoryPanel (UI-06)", () => {
  it("renders Apple-style summary cards from real history data", async () => {
    render(<HistoryPanel onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByTestId("history-stats")).toBeInTheDocument())
    expect(screen.getByText("Sessions")).toBeInTheDocument()
    expect(screen.getByText("Avg form")).toBeInTheDocument()
    expect(screen.getByText("Best streak")).toBeInTheDocument()
  })

  it("opens a tap-in session detail view that reuses the per-rep timeline primitives", async () => {
    render(<HistoryPanel onClose={vi.fn()} />)
    const openButtons = await screen.findAllByTestId("history-row-open")
    fireEvent.click(openButtons[0])

    expect(await screen.findByTestId("history-session-detail")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText("Snapshots")).toBeInTheDocument())
  })

  it("shows nothing for summary cards when there is no history", async () => {
    const { apiJson } = await import("../lib/api")
    vi.mocked(apiJson).mockResolvedValueOnce([])
    render(<HistoryPanel onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText("No sessions yet.")).toBeInTheDocument())
    expect(screen.queryByTestId("history-stats")).not.toBeInTheDocument()
  })
})
