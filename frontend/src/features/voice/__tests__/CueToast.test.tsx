import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CueToast, type ToastCue } from "../CueToast"

const CUE: ToastCue = { id: "c1", text: "Squat deeper for full range", severity: "high" }

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("CueToast", () => {
  it("renders nothing when there is no cue", () => {
    render(<CueToast cue={null} />)
    expect(screen.queryByTestId("cue-toast")).not.toBeInTheDocument()
  })

  it("shows the cue's text and severity as the visual twin of the spoken cue", () => {
    render(<CueToast cue={CUE} />)

    const toast = screen.getByTestId("cue-toast")
    expect(toast).toHaveTextContent("Squat deeper for full range")
    expect(toast).toHaveAttribute("data-severity", "high")
    expect(toast).not.toHaveClass("leaving")
  })

  it("adds the leaving class after visibleMs, then unmounts on that animation's end", () => {
    render(<CueToast cue={CUE} visibleMs={1000} />)

    const toast = screen.getByTestId("cue-toast")
    expect(toast).not.toHaveClass("leaving")

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByTestId("cue-toast")).toHaveClass("leaving")

    // The enter animation's own `animationend` (leaving=false) must NOT
    // unmount the toast — only the leave animation's end does.
    fireEvent.animationEnd(screen.getByTestId("cue-toast"))
    expect(screen.queryByTestId("cue-toast")).not.toBeInTheDocument()
  })

  it("does not unmount on animationend while still in the visible (non-leaving) phase", () => {
    render(<CueToast cue={CUE} visibleMs={5000} />)

    fireEvent.animationEnd(screen.getByTestId("cue-toast"))
    expect(screen.getByTestId("cue-toast")).toBeInTheDocument()
  })

  it("a new cue replaces the currently shown one instead of stacking", () => {
    const { rerender } = render(<CueToast cue={CUE} visibleMs={5000} />)
    expect(screen.getByTestId("cue-toast")).toHaveTextContent("Squat deeper for full range")

    const NEXT: ToastCue = { id: "c2", text: "Own the bottom. Don't rush it.", severity: "medium" }
    rerender(<CueToast cue={NEXT} visibleMs={5000} />)

    expect(screen.getAllByTestId("cue-toast")).toHaveLength(1)
    expect(screen.getByTestId("cue-toast")).toHaveTextContent("Own the bottom. Don't rush it.")
    expect(screen.getByTestId("cue-toast")).toHaveAttribute("data-severity", "medium")
    expect(screen.getByTestId("cue-toast")).not.toHaveClass("leaving")
  })
})
