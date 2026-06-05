import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { EmptyStageHint } from "../components/EmptyStageHint"
import { EXERCISE_META } from "../lib/exercises"

describe("EmptyStageHint", () => {
  it("names the active exercise and offers the how-to", () => {
    const onShowHowTo = vi.fn()
    render(<EmptyStageHint exercise="bench" onShowHowTo={onShowHowTo} />)
    expect(screen.getByText(EXERCISE_META.bench.label)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /view form tips/i }))
    expect(onShowHowTo).toHaveBeenCalledWith("bench")
  })
})
