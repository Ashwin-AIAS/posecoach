import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { DivisionSelector } from "../components/DivisionSelector"
import { DIVISION_LIST } from "../lib/poses"

describe("DivisionSelector", () => {
  it("lists every division", () => {
    render(<DivisionSelector value="open" onChange={vi.fn()} />)
    const select = screen.getByTestId("division-select") as HTMLSelectElement
    expect(select.options).toHaveLength(DIVISION_LIST.length)
  })

  it("reflects the active division and reports changes", () => {
    const onChange = vi.fn()
    render(<DivisionSelector value="open" onChange={onChange} />)
    const select = screen.getByTestId("division-select") as HTMLSelectElement
    expect(select.value).toBe("open")
    fireEvent.change(select, { target: { value: "bikini" } })
    expect(onChange).toHaveBeenCalledWith("bikini")
  })
})
