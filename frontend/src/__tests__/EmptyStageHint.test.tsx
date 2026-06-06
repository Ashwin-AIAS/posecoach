import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { EmptyStageHint } from "../components/EmptyStageHint"
import { EXERCISE_META } from "../lib/exercises"

describe("EmptyStageHint", () => {
  it("names the active exercise as a quiet framing nudge", () => {
    render(<EmptyStageHint exercise="bench" />)
    expect(screen.getByText(EXERCISE_META.bench.label)).toBeInTheDocument()
  })

  it("is unobtrusive — no button that could cover the camera", () => {
    render(<EmptyStageHint exercise="bench" />)
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })
})
