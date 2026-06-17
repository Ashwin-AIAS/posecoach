import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ChatPanel } from "../components/ChatPanel"

const send = vi.fn()

vi.mock("../hooks/useChat", () => ({
  useChat: () => ({
    messages: [],
    state: "idle",
    error: null,
    send,
    cancel: vi.fn(),
    regenerate: vi.fn(),
    setFeedback: vi.fn(),
  }),
}))

describe("ChatPanel (UI-05)", () => {
  it("sends a preset query when a quick-reply chip is tapped", () => {
    render(<ChatPanel exercise="squat" videoRef={{ current: null }} />)
    fireEvent.click(screen.getByTestId("chat-open-btn"))

    const chips = screen.getAllByTestId("quick-reply-chip")
    expect(chips.length).toBeGreaterThan(0)

    fireEvent.click(screen.getByText("Fix my back"))
    expect(send).toHaveBeenCalledWith({ query: "Fix my back", exercise: "squat" })
  })
})
