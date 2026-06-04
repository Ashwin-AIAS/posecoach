import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { CameraHud } from "../components/CameraHud"
import type { PoseResult } from "../types"

const base: PoseResult = {
  keypoints: [],
  confidence: [],
  score: 82,
  cues: ["Drive knees out wider"],
  latency_ms: 40,
}

describe("CameraHud", () => {
  it("renders nothing until the camera is active", () => {
    const { container } = render(
      <CameraHud result={base} active={false} exercise="squat" onShowHowTo={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("shows the rep counter for a rep-based exercise", () => {
    render(
      <CameraHud result={{ ...base, reps: 7 }} active exercise="squat" onShowHowTo={vi.fn()} />,
    )
    expect(screen.getByTestId("rep-counter").textContent).toContain("7")
    expect(screen.getByTestId("rep-counter").textContent).toContain("reps")
  })

  it("shows the hold timer instead of reps for plank", () => {
    render(
      <CameraHud result={{ ...base, hold_s: 12.4 }} active exercise="plank" onShowHowTo={vi.fn()} />,
    )
    expect(screen.queryByTestId("rep-counter")).toBeNull()
    expect(screen.getByText(/12\.4s/)).toBeInTheDocument()
  })

  it("renders the top coaching cue as a caption", () => {
    render(<CameraHud result={base} active exercise="squat" onShowHowTo={vi.fn()} />)
    expect(screen.getByText("Drive knees out wider")).toBeInTheDocument()
  })

  it("opens the how-to for the active exercise from the info button", () => {
    const onShowHowTo = vi.fn()
    render(<CameraHud result={base} active exercise="bench" onShowHowTo={onShowHowTo} />)
    fireEvent.click(screen.getByRole("button", { name: "Show how-to demo" }))
    expect(onShowHowTo).toHaveBeenCalledWith("bench")
  })

  it("shows a status banner (not a coaching cue) when the frame can't be scored", () => {
    render(
      <CameraHud
        result={{
          ...base,
          score: null,
          cues: ["Position yourself in frame"],
          status: "insufficient_confidence",
        }}
        active
        exercise="squat"
        onShowHowTo={vi.fn()}
        worst={{ key: "left_knee_angle", keypointIndex: 13, bodyPart: "left knee", score: 40 }}
      />,
    )
    expect(screen.getByTestId("status-banner").textContent).toContain("Position yourself in frame")
    // The cue is promoted to the banner, so the lower-third caption is suppressed.
    expect(screen.queryByText("Drive knees out wider")).toBeNull()
    // And a "fix this joint" callout must not appear when we can't even see them.
    expect(screen.queryByTestId("worst-joint-chip")).toBeNull()
  })

  it("falls back to default banner copy when no cue is supplied", () => {
    render(
      <CameraHud
        result={{ ...base, score: null, cues: [], status: "no_person" }}
        active
        exercise="squat"
        onShowHowTo={vi.fn()}
      />,
    )
    expect(screen.getByTestId("status-banner").textContent).toContain("Step into frame")
  })
})
