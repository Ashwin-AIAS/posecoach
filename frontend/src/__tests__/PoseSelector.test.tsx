import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { PoseSelector } from "../components/PoseSelector"
import { DIVISIONS, POSE_META } from "../lib/poses"

const OPEN = DIVISIONS.open.mandatories

describe("PoseSelector", () => {
  it("renders a radio for every pose in the given lineup", () => {
    render(<PoseSelector value="front_double_biceps" poses={OPEN} onChange={vi.fn()} />)
    expect(screen.getAllByRole("radio")).toHaveLength(OPEN.length)
    for (const id of OPEN) {
      expect(screen.getByRole("radio", { name: POSE_META[id].label })).toBeInTheDocument()
    }
  })

  it("marks the active pose and shows its hint", () => {
    render(<PoseSelector value="side_chest" poses={OPEN} onChange={vi.fn()} />)
    expect(screen.getByRole("radio", { name: "Side Chest" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByText(POSE_META.side_chest.hint)).toBeInTheDocument()
  })

  it("invokes onChange with the clicked pose", () => {
    const onChange = vi.fn()
    render(<PoseSelector value="front_double_biceps" poses={OPEN} onChange={onChange} />)
    fireEvent.click(screen.getByRole("radio", { name: "Front Lat Spread" }))
    expect(onChange).toHaveBeenCalledWith("front_lat_spread")
  })
})
