import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { PoseTrendChart } from "../components/PoseTrendChart"
import type { PosePoint } from "../types"

function point(symmetry: number | null, steadiness: number | null): PosePoint {
  return {
    session_id: Math.random().toString(),
    started_at: "2026-06-01T10:00:00Z",
    weeks_out: 8,
    avg_score: 90,
    symmetry,
    steadiness,
  }
}

describe("PoseTrendChart", () => {
  it("plots both symmetry and steadiness when present", () => {
    render(<PoseTrendChart points={[point(80, 70), point(85, 75)]} />)
    expect(screen.getByTestId("series-symmetry")).toBeInTheDocument()
    expect(screen.getByTestId("series-steadiness")).toBeInTheDocument()
  })

  it("omits the symmetry line for profile poses (all symmetry null)", () => {
    render(<PoseTrendChart points={[point(null, 70), point(null, 75)]} />)
    expect(screen.queryByTestId("series-symmetry")).not.toBeInTheDocument()
    expect(screen.getByTestId("series-steadiness")).toBeInTheDocument()
  })
})
