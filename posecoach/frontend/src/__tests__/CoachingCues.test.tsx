import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { CoachingCues } from "../components/CoachingCues"
import type { PoseResult } from "../types"

const sampleResult: PoseResult = {
  keypoints: [],
  confidence: [],
  score: 87.5,
  cues: ["Drive knees out wider", "Keep chest up and tall"],
  latency_ms: 42.1,
}

describe("CoachingCues", () => {
  it("renders the score rounded to the nearest integer", () => {
    render(
      <CoachingCues result={sampleResult} connectionState="open" error={null} />,
    )
    expect(screen.getByTestId("score-value").textContent).toBe("88")
  })

  it("renders an em-dash when no score is available", () => {
    render(<CoachingCues result={null} connectionState="connecting" error={null} />)
    expect(screen.getByTestId("score-value").textContent).toBe("—")
  })

  it("renders every coaching cue", () => {
    render(<CoachingCues result={sampleResult} connectionState="open" error={null} />)
    expect(screen.getByText("Drive knees out wider")).toBeInTheDocument()
    expect(screen.getByText("Keep chest up and tall")).toBeInTheDocument()
  })

  it("renders the connection pill", () => {
    render(<CoachingCues result={sampleResult} connectionState="open" error={null} />)
    expect(screen.getByTestId("connection-pill").textContent).toBe("Live")
  })

  it("renders hold timer when present (plank)", () => {
    const plankResult: PoseResult = { ...sampleResult, hold_s: 12.4 }
    render(<CoachingCues result={plankResult} connectionState="open" error={null} />)
    expect(screen.getByTestId("hold-timer").textContent).toContain("12.4")
  })

  it("hides hold timer for non-plank exercises", () => {
    render(<CoachingCues result={sampleResult} connectionState="open" error={null} />)
    expect(screen.queryByTestId("hold-timer")).toBeNull()
  })

  it("renders error message when error is present", () => {
    render(<CoachingCues result={null} connectionState="error" error="connection lost" />)
    expect(screen.getByTestId("error-msg").textContent).toBe("connection lost")
  })

  it("renders latency display from the result", () => {
    render(<CoachingCues result={sampleResult} connectionState="open" error={null} />)
    expect(screen.getByTestId("latency-display").textContent).toContain("42")
  })
})
