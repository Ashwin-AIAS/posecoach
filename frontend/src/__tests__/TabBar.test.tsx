import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { TabBar } from "../components/TabBar"
import type { TabKey } from "../components/TabBar"

const TAB_KEYS: readonly TabKey[] = ["coach", "workouts", "calories", "settings"]

describe("TabBar", () => {
  it("renders all four tabs with the active one selected", () => {
    render(<TabBar active="coach" onChange={vi.fn()} hidden={false} />)

    expect(screen.getByTestId("tab-bar")).toBeInTheDocument()
    for (const key of TAB_KEYS) {
      expect(screen.getByTestId(`tab-${key}`)).toBeInTheDocument()
    }
    expect(screen.getByTestId("tab-coach")).toHaveAttribute("aria-selected", "true")
    expect(screen.getByTestId("tab-workouts")).toHaveAttribute("aria-selected", "false")
  })

  it("exposes tablist/tab roles for assistive tech", () => {
    render(<TabBar active="workouts" onChange={vi.fn()} hidden={false} />)
    expect(screen.getByRole("tablist", { name: "Main navigation" })).toBeInTheDocument()
    expect(screen.getAllByRole("tab")).toHaveLength(4)
  })

  it("calls onChange with the clicked tab key", () => {
    const onChange = vi.fn()
    render(<TabBar active="coach" onChange={onChange} hidden={false} />)
    fireEvent.click(screen.getByTestId("tab-settings"))
    expect(onChange).toHaveBeenCalledWith("settings")
  })

  it("renders nothing when hidden (immersive live set)", () => {
    render(<TabBar active="coach" onChange={vi.fn()} hidden />)
    expect(screen.queryByTestId("tab-bar")).not.toBeInTheDocument()
  })
})
