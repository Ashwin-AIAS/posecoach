import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { DivisionSelector } from "../components/DivisionSelector"
import { DIVISION_LIST } from "../lib/poses"

describe("DivisionSelector", () => {
  it("collapses to a single chip showing the active category by default (P23)", () => {
    render(<DivisionSelector value="open" onChange={vi.fn()} />)
    expect(screen.getByTestId("division-select")).toHaveTextContent("Men's Open Bodybuilding")
    expect(screen.queryByRole("radiogroup", { name: "Division" })).not.toBeInTheDocument()
  })

  it("opens the division list on trigger click and lists every division", () => {
    render(<DivisionSelector value="open" onChange={vi.fn()} />)
    fireEvent.click(screen.getByTestId("division-change-btn"))

    const group = screen.getByRole("radiogroup", { name: "Division" })
    expect(group).toBeInTheDocument()
    expect(screen.getAllByRole("radio")).toHaveLength(DIVISION_LIST.length)
    for (const d of DIVISION_LIST) {
      expect(screen.getByRole("radio", { name: d.label })).toBeInTheDocument()
    }
  })

  it("marks the active division once opened", () => {
    render(<DivisionSelector value="bikini" onChange={vi.fn()} />)
    fireEvent.click(screen.getByTestId("division-change-btn"))

    expect(screen.getByRole("radio", { name: "Bikini" })).toHaveAttribute("aria-checked", "true")
  })

  it("invokes onChange and collapses back on selection", () => {
    const onChange = vi.fn()
    render(<DivisionSelector value="open" onChange={onChange} />)
    fireEvent.click(screen.getByTestId("division-change-btn"))
    fireEvent.click(screen.getByRole("radio", { name: "Bikini" }))

    expect(onChange).toHaveBeenCalledWith("bikini")
    expect(screen.queryByRole("radiogroup", { name: "Division" })).not.toBeInTheDocument()
  })
})
