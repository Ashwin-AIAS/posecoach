import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ModeToggle } from "../components/ModeToggle"

describe("ModeToggle", () => {
  it("marks the active mode with aria-checked", () => {
    render(<ModeToggle value="posing" onChange={vi.fn()} />)
    expect(screen.getByTestId("mode-posing")).toHaveAttribute("aria-checked", "true")
    expect(screen.getByTestId("mode-exercise")).toHaveAttribute("aria-checked", "false")
  })

  it("invokes onChange with the clicked mode", () => {
    const onChange = vi.fn()
    render(<ModeToggle value="exercise" onChange={onChange} />)
    fireEvent.click(screen.getByTestId("mode-posing"))
    expect(onChange).toHaveBeenCalledWith("posing")
  })
})
