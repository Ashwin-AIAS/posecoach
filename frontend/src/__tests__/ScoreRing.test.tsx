import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ScoreRing } from "../components/ScoreRing"
import { jointLabel } from "../lib/skeleton"

describe("ScoreRing", () => {
  it("renders the rounded score", () => {
    render(<ScoreRing score={87.6} />)
    expect(screen.getByTestId("ring-score-value").textContent).toBe("88")
  })

  it("renders an em-dash and accessible label when score is null", () => {
    render(<ScoreRing score={null} />)
    expect(screen.getByTestId("ring-score-value").textContent).toBe("—")
    expect(screen.getByRole("img", { name: /unavailable/i })).toBeInTheDocument()
  })

  it("exposes the score via an accessible label", () => {
    render(<ScoreRing score={72} />)
    expect(screen.getByRole("img", { name: "Form score 72 of 100" })).toBeInTheDocument()
  })
})

describe("jointLabel", () => {
  it("maps scorer joint keys to short HUD labels", () => {
    expect(jointLabel("left_knee_angle")).toBe("L Knee")
    expect(jointLabel("right_shoulder_angle")).toBe("R Shoulder")
    expect(jointLabel("hip_trunk_angle")).toBe("Trunk")
  })
})
