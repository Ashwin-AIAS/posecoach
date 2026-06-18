import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { PoseSelector } from "../components/PoseSelector"
import { DIVISIONS, POSE_META } from "../lib/poses"

const OPEN = DIVISIONS.open.mandatories

describe("PoseSelector", () => {
  it("collapses to a single chip showing the active pose by default", () => {
    render(<PoseSelector value="front_double_biceps" poses={OPEN} onChange={vi.fn()} />)
    expect(screen.getByTestId("pose-current-label")).toHaveTextContent("Front Double Biceps")
    expect(screen.queryByRole("radiogroup", { name: "Pose" })).not.toBeInTheDocument()
  })

  it("opens the pose list on trigger click", () => {
    render(<PoseSelector value="front_double_biceps" poses={OPEN} onChange={vi.fn()} />)
    fireEvent.click(screen.getByTestId("pose-change-btn"))

    const group = screen.getByRole("radiogroup", { name: "Pose" })
    expect(group).toBeInTheDocument()
    expect(screen.getAllByRole("radio")).toHaveLength(OPEN.length)
    for (const id of OPEN) {
      expect(screen.getByRole("radio", { name: POSE_META[id].label })).toBeInTheDocument()
    }
  })

  it("marks the active pose and shows its hint once opened", () => {
    render(<PoseSelector value="side_chest" poses={OPEN} onChange={vi.fn()} />)
    fireEvent.click(screen.getByTestId("pose-change-btn"))

    expect(screen.getByRole("radio", { name: "Side Chest" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByText(POSE_META.side_chest.hint)).toBeInTheDocument()
  })

  it("invokes onChange and collapses back on selection", () => {
    const onChange = vi.fn()
    render(<PoseSelector value="front_double_biceps" poses={OPEN} onChange={onChange} />)
    fireEvent.click(screen.getByTestId("pose-change-btn"))
    fireEvent.click(screen.getByRole("radio", { name: "Front Lat Spread" }))

    expect(onChange).toHaveBeenCalledWith("front_lat_spread")
    expect(screen.queryByRole("radiogroup", { name: "Pose" })).not.toBeInTheDocument()
  })
})
