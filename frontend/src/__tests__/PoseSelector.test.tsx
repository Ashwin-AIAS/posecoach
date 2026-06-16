import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { PoseSelector } from "../components/PoseSelector"
import { POSE_META } from "../lib/poses"
import { POSES } from "../types"

describe("PoseSelector", () => {
  it("renders a radio for every seed pose", () => {
    render(<PoseSelector value="front_double_biceps" onChange={vi.fn()} />)
    expect(screen.getAllByRole("radio")).toHaveLength(POSES.length)
    for (const id of POSES) {
      expect(screen.getByRole("radio", { name: POSE_META[id].label })).toBeInTheDocument()
    }
  })

  it("marks the active pose and shows its hint", () => {
    render(<PoseSelector value="rear_double_biceps" onChange={vi.fn()} />)
    expect(screen.getByRole("radio", { name: "Rear Double Biceps" })).toHaveAttribute(
      "aria-checked",
      "true",
    )
    expect(screen.getByText(POSE_META.rear_double_biceps.hint)).toBeInTheDocument()
  })

  it("invokes onChange with the clicked pose", () => {
    const onChange = vi.fn()
    render(<PoseSelector value="front_double_biceps" onChange={onChange} />)
    fireEvent.click(screen.getByRole("radio", { name: "Front Lat Spread" }))
    expect(onChange).toHaveBeenCalledWith("front_lat_spread")
  })
})
