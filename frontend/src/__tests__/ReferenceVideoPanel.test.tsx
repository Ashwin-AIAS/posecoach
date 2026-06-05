import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ReferenceVideoPanel } from "../components/ReferenceVideoPanel"
import { EXERCISE_META } from "../lib/exercises"

describe("ReferenceVideoPanel", () => {
  it("is collapsed by default and mounts no iframe or thumbnail (no bandwidth on a workout)", () => {
    render(<ReferenceVideoPanel exercise="squat" />)
    const toggle = screen.getByTestId("reference-video-toggle")
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByTestId("reference-video-play")).toBeNull()
    expect(document.querySelector("iframe")).toBeNull()
    expect(document.querySelector("img")).toBeNull()
  })

  it("reveals only a thumbnail facade (no iframe) when expanded", () => {
    render(<ReferenceVideoPanel exercise="squat" />)
    fireEvent.click(screen.getByTestId("reference-video-toggle"))
    expect(screen.getByTestId("reference-video-play")).toBeInTheDocument()
    expect(document.querySelector("iframe")).toBeNull()
  })

  it("injects the correct youtube-nocookie iframe for the exercise only after play, no autoplay", () => {
    render(<ReferenceVideoPanel exercise="bench" />)
    fireEvent.click(screen.getByTestId("reference-video-toggle"))
    fireEvent.click(screen.getByTestId("reference-video-play"))
    const iframe = document.querySelector("iframe")
    expect(iframe).not.toBeNull()
    const src = iframe?.getAttribute("src") ?? ""
    expect(src).toContain("youtube-nocookie.com/embed/")
    expect(src).toContain(EXERCISE_META.bench.youtubeId)
    expect(src).not.toContain("autoplay")
  })

  it("tears the iframe back down to the facade when the exercise changes", () => {
    const { rerender } = render(<ReferenceVideoPanel exercise="bench" />)
    fireEvent.click(screen.getByTestId("reference-video-toggle"))
    fireEvent.click(screen.getByTestId("reference-video-play"))
    expect(document.querySelector("iframe")).not.toBeNull()
    rerender(<ReferenceVideoPanel exercise="squat" />)
    expect(document.querySelector("iframe")).toBeNull()
    expect(screen.getByTestId("reference-video-play")).toBeInTheDocument()
  })
})
