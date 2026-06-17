import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import App from "../App"

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

describe("App (UI-07 navigation)", () => {
  it("starts on Home and navigates to the live view and back", async () => {
    render(<App />)

    await waitFor(() => expect(screen.getByTestId("home-view")).toBeInTheDocument())
    expect(screen.queryByTestId("back-home-btn")).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId("start-workout-btn"))

    expect(screen.queryByTestId("home-view")).not.toBeInTheDocument()
    const backBtn = screen.getByTestId("back-home-btn")
    expect(backBtn).toBeInTheDocument()

    fireEvent.click(backBtn)

    await waitFor(() => expect(screen.getByTestId("home-view")).toBeInTheDocument())
    expect(screen.queryByTestId("back-home-btn")).not.toBeInTheDocument()
  })
})
