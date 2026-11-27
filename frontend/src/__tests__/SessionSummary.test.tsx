import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SessionSummary } from "../components/SessionSummary"
import { apiJson, submitEffort } from "../lib/api"
import { shareResultCard } from "../lib/shareCard"
import type { RecordedSession } from "../hooks/useSessionRecorder"
import type { SessionStats } from "../hooks/useSessionStats"

vi.mock("../lib/api", () => ({ apiJson: vi.fn(), submitEffort: vi.fn() }))
vi.mock("../lib/shareCard", () => ({ shareResultCard: vi.fn(async () => "downloaded") }))
const mockApiJson = vi.mocked(apiJson)
const mockSubmitEffort = vi.mocked(submitEffort)
const mockShareResultCard = vi.mocked(shareResultCard)

const stats: SessionStats = {
  reps: 9,
  avgScore: 84.4,
  bestScore: 96,
  samples: 120,
  repScores: [],
  repTimesMs: [],
  holdSeries: [],
}

describe("SessionSummary", () => {
  beforeEach(() => {
    mockApiJson.mockReset()
    mockSubmitEffort.mockReset()
    mockShareResultCard.mockReset()
    URL.createObjectURL = vi.fn(() => "blob:replay")
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
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
      repTimesMs: [],
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
      repTimesMs: [],
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
      repTimesMs: [],
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

  it("triggers on-device result card sharing when Share is tapped (B3)", async () => {
    mockApiJson.mockResolvedValueOnce([])
    mockShareResultCard.mockResolvedValueOnce("downloaded")
    render(<SessionSummary exercise="squat" stats={stats} onClose={vi.fn()} />)
    const shareBtn = screen.getByTestId("share-card-btn")
    fireEvent.click(shareBtn)
    await waitFor(() => expect(mockShareResultCard).toHaveBeenCalledTimes(1))
    expect(mockShareResultCard).toHaveBeenCalledWith(
      expect.objectContaining({
        exerciseId: "squat",
        exerciseLabel: "Squat",
        reps: 9,
      }),
    )
    await waitFor(() => expect(shareBtn).toHaveTextContent("Saved"))
  })

  it("shows the Record hint and disables rep-bar buttons when recording is absent (B4)", async () => {
    mockApiJson.mockResolvedValueOnce([])
    const setWithReps: SessionStats = {
      reps: 2,
      avgScore: 82,
      bestScore: 86,
      samples: 40,
      repScores: [78, 86],
      repTimesMs: [14_000, 18_500],
      holdSeries: [],
    }
    render(<SessionSummary exercise="squat" stats={setWithReps} onClose={vi.fn()} />)
    expect(screen.getByText("Tap Record before a set to replay reps")).toBeInTheDocument()
    expect(screen.queryByTestId("rep-replay-btn-0")).not.toBeInTheDocument()
    expect(screen.queryByTestId("rep-replay-video")).not.toBeInTheDocument()
  })

  it("seeks to repTimesMs[i] - startedAtMs - 1500ms and plays when a rep bar is tapped (B4)", async () => {
    mockApiJson.mockResolvedValueOnce([])
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(async () => {})
    const pauseSpy = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => {})

    const recording: RecordedSession = {
      blob: new Blob(["vid"], { type: "video/mp4" }),
      fileName: "posecoach-squat-1.mp4",
      mimeType: "video/mp4",
      startedAtMs: 10_000,
    }
    const setWithReps: SessionStats = {
      reps: 2,
      avgScore: 82,
      bestScore: 86,
      samples: 40,
      repScores: [78, 86],
      repTimesMs: [14_000, 18_500],
      holdSeries: [],
    }
    render(
      <SessionSummary
        exercise="squat"
        stats={setWithReps}
        recording={recording}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByTestId("rep-replay-hint")).not.toBeInTheDocument()

    const video = (await screen.findByTestId("rep-replay-video")) as HTMLVideoElement
    fireEvent.click(screen.getByTestId("rep-replay-btn-1"))

    // 18_500 - 10_000 - 1500 = 7000ms -> 7.0s
    expect(video.currentTime).toBe(7)
    expect(playSpy).toHaveBeenCalledTimes(1)

    // Advancing past endSec (10.0s) pauses automatically
    video.currentTime = 10.1
    fireEvent.timeUpdate(video)
    expect(pauseSpy).toHaveBeenCalledTimes(1)
  })
})
