import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SetCountdownOverlay } from "../SetCountdownOverlay"

describe("SetCountdownOverlay (P36 A5)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("counts down 3 -> 2 -> 1 and calls onComplete (stats.reset) when finished", () => {
    const onComplete = vi.fn()
    render(<SetCountdownOverlay onComplete={onComplete} />)

    expect(screen.getByTestId("set-countdown-value")).toHaveTextContent("3")
    expect(onComplete).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByTestId("set-countdown-value")).toHaveTextContent("2")
    expect(onComplete).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByTestId("set-countdown-value")).toHaveTextContent("1")
    expect(onComplete).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it("calls onComplete immediately when Start now is tapped", () => {
    const onComplete = vi.fn()
    render(<SetCountdownOverlay onComplete={onComplete} />)

    fireEvent.click(screen.getByTestId("set-countdown-skip"))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})
