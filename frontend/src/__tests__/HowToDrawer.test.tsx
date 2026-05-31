import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { HowToDrawer } from "../components/HowToDrawer"
import { EXERCISE_META } from "../lib/exercises"

describe("HowToDrawer", () => {
  it("renders nothing when no exercise is selected", () => {
    const { container } = render(<HowToDrawer exercise={null} onClose={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("shows the thumbnail facade first, not an iframe (privacy + perf)", () => {
    render(<HowToDrawer exercise="squat" onClose={vi.fn()} />)
    expect(screen.getByTestId("howto-play")).toBeInTheDocument()
    expect(document.querySelector("iframe")).toBeNull()
  })

  it("injects a youtube-nocookie iframe only after clicking play, with no autoplay", () => {
    render(<HowToDrawer exercise="bench" onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId("howto-play"))
    const iframe = document.querySelector("iframe")
    expect(iframe).not.toBeNull()
    const src = iframe?.getAttribute("src") ?? ""
    expect(src).toContain("youtube-nocookie.com/embed/")
    expect(src).toContain(EXERCISE_META.bench.youtubeId)
    expect(src).not.toContain("autoplay")
  })

  it("shows the exercise's form tips and primary muscles as a learning surface", () => {
    render(<HowToDrawer exercise="squat" onClose={vi.fn()} />)
    expect(screen.getByText(EXERCISE_META.squat.formTips[0])).toBeInTheDocument()
    expect(screen.getByText(EXERCISE_META.squat.primaryMuscles[0])).toBeInTheDocument()
  })

  it("closes on backdrop click and Escape", () => {
    const onClose = vi.fn()
    render(<HowToDrawer exercise="curl" onClose={onClose} />)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId("howto-drawer"))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
