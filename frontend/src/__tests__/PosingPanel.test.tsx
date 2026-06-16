import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { PosingPanel } from "../components/PosingPanel"
import { POSING_SCOPE_NOTE } from "../lib/poses"
import type { PoseResult } from "../types"

function poseResult(over: Partial<PoseResult> = {}): PoseResult {
  return {
    keypoints: [],
    confidence: [],
    score: 88,
    cues: [],
    latency_ms: 30,
    symmetry: 94,
    hold: { seconds: 2.5, stability: 90, steady: true },
    orientation: "front",
    status: "ok",
    ...over,
  }
}

describe("PosingPanel", () => {
  it("renders the pose label and the honest scope note", () => {
    render(<PosingPanel result={poseResult()} pose="front_double_biceps" />)
    expect(screen.getByText("Front Double Biceps")).toBeInTheDocument()
    expect(screen.getByText(POSING_SCOPE_NOTE)).toBeInTheDocument()
  })

  it("shows score, symmetry and hold metrics", () => {
    render(<PosingPanel result={poseResult()} pose="front_double_biceps" />)
    expect(screen.getByTestId("posing-score")).toHaveTextContent("88")
    expect(screen.getByTestId("posing-symmetry")).toHaveTextContent("94")
    expect(screen.getByTestId("posing-hold")).toHaveTextContent("2.5s")
  })

  it("renders dashes when no frame has been scored yet", () => {
    render(<PosingPanel result={null} pose="front_double_biceps" />)
    expect(screen.getByTestId("posing-score")).toHaveTextContent("—")
    expect(screen.getByTestId("posing-hold")).toHaveTextContent("—")
  })

  it("surfaces a wrong-orientation warning", () => {
    const result = poseResult({
      status: "wrong_orientation",
      score: null,
      symmetry: null,
      cues: ["Turn your back to the camera"],
    })
    render(<PosingPanel result={result} pose="rear_double_biceps" />)
    expect(screen.getByTestId("posing-orientation-warn")).toHaveTextContent(
      "Turn your back to the camera",
    )
  })
})
