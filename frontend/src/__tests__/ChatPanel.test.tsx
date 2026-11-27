import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

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

beforeEach(() => {
  send.mockClear()
})

describe("ChatPanel (UI-05 + P36 C4/C5)", () => {
  it("renders a single de-duplicated suggestion row with no emoji and sends on tap", () => {
    render(<ChatPanel exercise="squat" videoRef={{ current: null }} />)
    fireEvent.click(screen.getByTestId("chat-open-btn"))

    // Only one suggestion row (3 chips), no duplicate starter prompt row.
    const chips = screen.getAllByTestId("quick-reply-chip")
    expect(chips).toHaveLength(3)

    // No emoji in welcome copy.
    expect(screen.queryByText(/💪/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText("Fix my back"))
    expect(send).toHaveBeenCalledWith({ query: "Fix my back", exercise: "squat" })
  })

  it("tailors suggestion chips from session history (last + worst-trending exercise)", () => {
    const sessions = [
      { id: "s1", exercise: "deadlift", rep_count: 5, avg_form_score: 60, started_at: "2026-11-26T10:00:00Z", ended_at: null },
      { id: "s2", exercise: "deadlift", rep_count: 5, avg_form_score: 82, started_at: "2026-11-10T10:00:00Z", ended_at: null },
      { id: "s3", exercise: "bench", rep_count: 8, avg_form_score: 88, started_at: "2026-11-27T10:00:00Z", ended_at: null },
    ]
    render(<ChatPanel exercise="squat" startOpen sessions={sessions} />)

    const chips = screen.getAllByTestId("quick-reply-chip").map((c) => c.textContent)
    expect(chips).toHaveLength(3)
    expect(chips[0]).toBe("Fix my deadlift form")
    expect(chips[1]).toBe("Next target for bench press?")
  })

  it("shows signed-out callout when authed is false and triggers onSignIn", () => {
    const onSignIn = vi.fn()
    render(<ChatPanel exercise="squat" startOpen authed={false} onSignIn={onSignIn} />)

    expect(screen.getByTestId("coach-signed-out-empty")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("coach-sign-in-btn"))
    expect(onSignIn).toHaveBeenCalledTimes(1)
  })

  it("prefills input when initialPrompt is provided", () => {
    render(
      <ChatPanel
        exercise="squat"
        startOpen
        initialPrompt="How do I keep my knees out?"
      />,
    )
    expect(screen.getByTestId("chat-input")).toHaveValue("How do I keep my knees out?")
  })
})
