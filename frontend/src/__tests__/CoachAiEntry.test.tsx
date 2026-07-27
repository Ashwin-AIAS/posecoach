import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import App from "../App"

/**
 * P35 — "Coach AI" must be reachable in one tap from Home (text-only, no
 * camera) and one tap in the live view (tray opens already on Chat).
 */
const mocks = vi.hoisted(() => ({
  cameraStart: vi.fn(async () => {}),
  poseStreamCalls: [] as { active: boolean }[],
  send: vi.fn(),
}))

vi.mock("../lib/api", () => ({
  apiJson: vi.fn(async (path: string) => {
    if (path === "/api/v1/auth/me") throw new Error("unauthenticated")
    if (path === "/api/v1/history/sessions") return []
    throw new Error(`unexpected path: ${path}`)
  }),
  apiFetch: vi.fn(),
  fetchRecommendation: vi.fn(async () => null),
}))

vi.mock("../hooks/useCamera", () => ({
  useCamera: () => ({
    videoRef: { current: null },
    ready: false,
    error: null,
    facingMode: "user",
    stop: vi.fn(),
    start: mocks.cameraStart,
    flip: vi.fn(),
  }),
}))

vi.mock("../hooks/usePoseStream", () => ({
  usePoseStream: (args: { active: boolean }) => {
    mocks.poseStreamCalls.push({ active: args.active })
    return { result: null, error: null, connectionState: "idle" }
  },
}))

vi.mock("../hooks/useChat", () => ({
  useChat: () => ({
    messages: [],
    state: "idle",
    error: null,
    send: mocks.send,
    cancel: vi.fn(),
    regenerate: vi.fn(),
    setFeedback: vi.fn(),
  }),
}))

describe("Coach AI entry points (P35)", () => {
  it("opens chat from Home in one tap without starting a camera session", async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByTestId("home-view")).toBeInTheDocument())

    fireEvent.click(screen.getByTestId("coach-ai-btn"))

    // The chat is immediately usable — no nested "Ask the coach" toggle.
    expect(screen.getByTestId("coach-ai-sheet")).toBeInTheDocument()
    expect(screen.getByTestId("chat-input")).toBeInTheDocument()
    expect(screen.queryByTestId("chat-open-btn")).not.toBeInTheDocument()

    // Text-only path: no camera, no live pose stream, no frame button.
    expect(screen.queryByTestId("camera-stage")).not.toBeInTheDocument()
    expect(screen.queryByTestId("chat-frame-btn")).not.toBeInTheDocument()
    expect(mocks.cameraStart).not.toHaveBeenCalled()
    expect(mocks.poseStreamCalls.every((c) => c.active === false)).toBe(true)

    fireEvent.click(screen.getByTestId("coach-ai-close"))
    expect(screen.queryByTestId("coach-ai-sheet")).not.toBeInTheDocument()
  })

  it("sends a question typed into the Home chat", async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByTestId("home-view")).toBeInTheDocument())
    fireEvent.click(screen.getByTestId("coach-ai-btn"))

    fireEvent.change(screen.getByTestId("chat-input"), {
      target: { value: "How much protein per day?" },
    })
    fireEvent.click(screen.getByText("Send"))

    expect(mocks.send).toHaveBeenCalledWith({
      query: "How much protein per day?",
      exercise: "squat",
      frame: null,
    })
  })

  it("live-view trigger opens the tray already on the Chat tab, expanded", async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByTestId("home-view")).toBeInTheDocument())
    fireEvent.click(screen.getByTestId("start-workout-btn"))

    fireEvent.click(screen.getByTestId("coach-ai-trigger"))

    const chatTab = screen.getByRole("tab", { name: "Chat" })
    expect(chatTab).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: "Coaching" })).toHaveAttribute(
      "aria-selected",
      "false",
    )
    expect(screen.getByTestId("chat-input")).toBeInTheDocument()
  })

  it("leaves the existing tray trigger on Cues with the chat collapsed", async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByTestId("home-view")).toBeInTheDocument())
    fireEvent.click(screen.getByTestId("start-workout-btn"))

    fireEvent.click(screen.getByTestId("tray-trigger"))

    expect(screen.getByRole("tab", { name: "Coaching" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    // Switching to Chat by hand keeps the pre-P35 collapsed entry.
    fireEvent.click(screen.getByRole("tab", { name: "Chat" }))
    const tray = within(screen.getByRole("dialog", { name: "Coaching and chat" }))
    expect(tray.getByTestId("chat-open-btn")).toBeInTheDocument()
    expect(tray.queryByTestId("chat-input")).not.toBeInTheDocument()
  })
})
