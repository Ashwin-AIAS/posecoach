import { render, screen, fireEvent, act } from "@testing-library/react"
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest"

import { RestTimer } from "../components/RestTimer"

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("RestTimer", () => {
  it("renders with testid", () => {
    render(<RestTimer />)
    expect(screen.getByTestId("rest-timer")).toBeInTheDocument()
  })

  it("renders start and reset buttons", () => {
    render(<RestTimer />)
    expect(screen.getByTestId("rest-timer-toggle")).toBeInTheDocument()
    expect(screen.getByTestId("rest-timer-reset")).toBeInTheDocument()
  })

  it("starts counting down when start is clicked", () => {
    render(<RestTimer defaultSeconds={10} />)
    fireEvent.click(screen.getByTestId("rest-timer-toggle"))

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(screen.getByTestId("rest-timer-toggle")).toHaveTextContent("Pause")
  })

  it("resets when reset button is clicked", () => {
    render(<RestTimer defaultSeconds={10} />)
    fireEvent.click(screen.getByTestId("rest-timer-toggle"))

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    fireEvent.click(screen.getByTestId("rest-timer-reset"))
    expect(screen.getByTestId("rest-timer-toggle")).toHaveTextContent("Start")
  })
})
