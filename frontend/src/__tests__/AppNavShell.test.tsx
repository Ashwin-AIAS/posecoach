import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import App from "../App"

// Same mocks as App.test.tsx — the nav-shell cases live in their own file so
// the existing App.test.tsx stays byte-for-byte unchanged (P23: App.tsx is the
// only existing file this prompt edits).
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
    start: vi.fn(async () => {}),
    flip: vi.fn(),
  }),
}))

vi.mock("../hooks/usePoseStream", () => ({
  usePoseStream: () => ({ result: null, error: null, connectionState: "idle" }),
}))

describe("App (P23 navigation shell)", () => {
  it("starts on the Coach tab with Home and the tab bar visible", async () => {
    render(<App />)

    await waitFor(() => expect(screen.getByTestId("home-view")).toBeInTheDocument())
    expect(screen.getByTestId("tab-bar")).toBeInTheDocument()
    expect(screen.getByTestId("tab-coach")).toHaveAttribute("aria-selected", "true")
  })

  it("switches to the Workouts tab, swapping Coach for the placeholder and back", async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByTestId("home-view")).toBeInTheDocument())

    fireEvent.click(screen.getByTestId("tab-workouts"))

    expect(screen.queryByTestId("home-view")).not.toBeInTheDocument()
    expect(screen.getByTestId("coming-soon")).toBeInTheDocument()
    expect(screen.getByTestId("tab-workouts")).toHaveAttribute("aria-selected", "true")

    // Returning to Coach restores the unchanged Home experience.
    fireEvent.click(screen.getByTestId("tab-coach"))
    expect(screen.getByTestId("home-view")).toBeInTheDocument()
  })

  it("hides the tab bar during a live set for the immersive camera view", async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByTestId("home-view")).toBeInTheDocument())

    fireEvent.click(screen.getByTestId("start-workout-btn"))

    expect(screen.getByTestId("back-home-btn")).toBeInTheDocument()
    expect(screen.queryByTestId("tab-bar")).not.toBeInTheDocument()
  })
})
