import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ChatMessage } from "../components/ChatMessage"
import type { ChatMessage as ChatMessageType } from "../hooks/useChat"

const baseMessage: ChatMessageType = {
  id: "1700000000000-abc123",
  role: "assistant",
  text: "Keep your knees tracking over your toes.",
  hasFrame: false,
  feedback: null,
}

describe("ChatMessage (UI-05)", () => {
  it("shows a subtle timestamp recovered from the message id", () => {
    render(<ChatMessage message={baseMessage} isLast={false} isStreaming={false} chatState="idle" />)
    expect(screen.getByTestId("message-timestamp")).toBeInTheDocument()
  })

  it("shows a 'Looking at your form' affordance on a user message with a frame", () => {
    const userMsg: ChatMessageType = { ...baseMessage, role: "user", hasFrame: true, text: "How's my depth?" }
    render(<ChatMessage message={userMsg} isLast={false} isStreaming={false} chatState="idle" />)
    expect(screen.getByText("Looking at your form")).toBeInTheDocument()
  })

  it("shows the frame-aware thinking copy when respondingToFrame is set", () => {
    const pending: ChatMessageType = { ...baseMessage, text: "" }
    render(
      <ChatMessage
        message={pending}
        isLast={true}
        isStreaming={false}
        chatState="thinking"
        respondingToFrame
      />,
    )
    expect(screen.getByText(/Looking at your form…/)).toBeInTheDocument()
  })

  it("falls back to the generic thinking copy without a frame", () => {
    const pending: ChatMessageType = { ...baseMessage, text: "" }
    render(<ChatMessage message={pending} isLast={true} isStreaming={false} chatState="thinking" />)
    expect(screen.getByText("Coach is thinking…")).toBeInTheDocument()
  })
})
