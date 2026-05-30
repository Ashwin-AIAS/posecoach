import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ExerciseSelector } from "../components/ExerciseSelector"
import { EXERCISES } from "../types"

describe("ExerciseSelector", () => {
  it("renders all 7 supported exercises", () => {
    render(<ExerciseSelector value="squat" onChange={vi.fn()} />)
    for (const ex of EXERCISES) {
      const label = ex === "ohp" ? "OHP" : ex.charAt(0).toUpperCase() + ex.slice(1)
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument()
    }
  })

  it("marks the active exercise with aria-checked", () => {
    render(<ExerciseSelector value="deadlift" onChange={vi.fn()} />)
    expect(screen.getByRole("radio", { name: "Deadlift" })).toHaveAttribute(
      "aria-checked",
      "true",
    )
    expect(screen.getByRole("radio", { name: "Squat" })).toHaveAttribute(
      "aria-checked",
      "false",
    )
  })

  it("invokes onChange with the clicked exercise", () => {
    const onChange = vi.fn()
    render(<ExerciseSelector value="squat" onChange={onChange} />)
    fireEvent.click(screen.getByRole("radio", { name: "Plank" }))
    expect(onChange).toHaveBeenCalledWith("plank")
  })

  it("respects disabled prop", () => {
    render(<ExerciseSelector value="squat" onChange={vi.fn()} disabled />)
    expect(screen.getByRole("radio", { name: "Curl" })).toBeDisabled()
  })
})
