import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ProgressionChart } from "../components/ProgressionChart"
import type { SessionPoint } from "../lib/progression"

const POINTS: readonly SessionPoint[] = [
  { workoutId: "w1", date: "2026-07-01T10:00:00Z", bestE1rm: 100, volumeKg: 700 },
  { workoutId: "w2", date: "2026-07-02T10:00:00Z", bestE1rm: 110, volumeKg: 815 },
  { workoutId: "w3", date: "2026-07-03T10:00:00Z", bestE1rm: 116.7, volumeKg: 900 },
]

describe("ProgressionChart", () => {
  it("renders nothing with no points", () => {
    const { container } = render(<ProgressionChart points={[]} unit="kg" />)
    expect(container.firstChild).toBeNull()
  })

  it("renders one e1RM dot and one volume bar per session", () => {
    const { container } = render(<ProgressionChart points={POINTS} unit="kg" />)
    expect(container.querySelectorAll('[data-testid="series-e1rm"] circle')).toHaveLength(3)
    expect(container.querySelectorAll('[data-testid="series-volume"] rect')).toHaveLength(3)
    // 3 points → a connecting trend line exists.
    expect(container.querySelector('[data-testid="series-e1rm"] polyline')).not.toBeNull()
  })

  it("labels the latest values in kg", () => {
    render(<ProgressionChart points={POINTS} unit="kg" />)
    expect(screen.getByTestId("e1rm-last")).toHaveTextContent("117 kg")
    expect(screen.getByTestId("volume-last")).toHaveTextContent("900 kg")
  })

  it("converts label values when the unit preference is lb", () => {
    render(<ProgressionChart points={POINTS} unit="lb" />)
    // 116.7 kg ≈ 257 lb; 900 kg ≈ 1984 lb.
    expect(screen.getByTestId("e1rm-last")).toHaveTextContent("257 lb")
    expect(screen.getByTestId("volume-last")).toHaveTextContent("1984 lb")
  })

  it("exposes an aria-label summary for screen readers", () => {
    render(<ProgressionChart points={POINTS} unit="kg" />)
    expect(
      screen.getByRole("img", { name: /best 117 kg/i }),
    ).toBeInTheDocument()
  })
})
