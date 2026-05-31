import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ExerciseSelector } from "../components/ExerciseSelector"
import { EXERCISE_META } from "../lib/exercises"
import { EXERCISES } from "../types"

function openSheet(): void {
  fireEvent.click(screen.getByTestId("exercise-change-btn"))
}

describe("ExerciseSelector", () => {
  it("shows the active exercise label in the collapsed bar", () => {
    render(<ExerciseSelector value="deadlift" onChange={vi.fn()} onShowHowTo={vi.fn()} />)
    expect(screen.getByText("Deadlift")).toBeInTheDocument()
  })

  it("reveals a radio for every supported exercise when opened", () => {
    render(<ExerciseSelector value="squat" onChange={vi.fn()} onShowHowTo={vi.fn()} />)
    openSheet()
    expect(screen.getAllByRole("radio")).toHaveLength(EXERCISES.length)
    for (const ex of EXERCISES) {
      expect(screen.getByRole("radio", { name: EXERCISE_META[ex].label })).toBeInTheDocument()
    }
  })

  it("marks the active exercise with aria-checked", () => {
    render(<ExerciseSelector value="bench" onChange={vi.fn()} onShowHowTo={vi.fn()} />)
    openSheet()
    expect(screen.getByRole("radio", { name: "Bench Press" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radio", { name: "Squat" })).toHaveAttribute("aria-checked", "false")
  })

  it("invokes onChange with the clicked exercise and closes the sheet", () => {
    const onChange = vi.fn()
    render(<ExerciseSelector value="squat" onChange={onChange} onShowHowTo={vi.fn()} />)
    openSheet()
    fireEvent.click(screen.getByRole("radio", { name: "Push-Up" }))
    expect(onChange).toHaveBeenCalledWith("pushup")
    expect(screen.queryByRole("radiogroup")).toBeNull()
  })

  it("filters the grid by the search query", () => {
    render(<ExerciseSelector value="squat" onChange={vi.fn()} onShowHowTo={vi.fn()} />)
    openSheet()
    fireEvent.change(screen.getByTestId("exercise-search"), { target: { value: "curl" } })
    const radios = screen.getAllByRole("radio")
    expect(radios.length).toBeGreaterThan(0)
    expect(radios.length).toBeLessThan(EXERCISES.length)
    expect(screen.getByRole("radio", { name: "Hammer Curl" })).toBeInTheDocument()
    expect(screen.queryByRole("radio", { name: "Squat" })).toBeNull()
  })

  it("invokes onShowHowTo when a card's ? button is clicked", () => {
    const onShowHowTo = vi.fn()
    render(<ExerciseSelector value="squat" onChange={vi.fn()} onShowHowTo={onShowHowTo} />)
    openSheet()
    fireEvent.click(screen.getByRole("button", { name: "How to Lateral Raise" }))
    expect(onShowHowTo).toHaveBeenCalledWith("lateral_raise")
  })

  it("respects the disabled prop on the change button", () => {
    render(<ExerciseSelector value="squat" onChange={vi.fn()} onShowHowTo={vi.fn()} disabled />)
    expect(screen.getByTestId("exercise-change-btn")).toBeDisabled()
  })
})
