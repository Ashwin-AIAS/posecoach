import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ForgotPasswordPage } from "../components/ForgotPasswordPage"

function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal("fetch", fn)
  return fn
}

beforeEach(() => {
  window.history.replaceState(null, "", "/forgot-password")
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ForgotPasswordPage", () => {
  it("renders the email form in password mode by default", () => {
    render(<ForgotPasswordPage />)
    expect(screen.getByTestId("forgot-form")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeInTheDocument()
  })

  it("submits the email and shows the generic confirmation", async () => {
    const fn = mockFetch(200, { message: "If that email is registered…" })
    render(<ForgotPasswordPage />)

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@x.com" } })
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }))

    await waitFor(() => expect(screen.getByTestId("forgot-confirmation")).toBeInTheDocument())
    expect(screen.getByTestId("forgot-confirmation").textContent).toMatch(/if that email is registered/i)
    expect(String(fn.mock.calls[0]?.[0])).toContain("/api/v1/auth/forgot-password")
  })

  it("preselects username mode from ?mode=username and hits forgot-username", async () => {
    window.history.replaceState(null, "", "/forgot-password?mode=username")
    const fn = mockFetch(200, { message: "ok" })
    render(<ForgotPasswordPage />)

    expect(screen.getByRole("button", { name: "Send username" })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@x.com" } })
    fireEvent.click(screen.getByRole("button", { name: "Send username" }))

    await waitFor(() => expect(screen.getByTestId("forgot-confirmation")).toBeInTheDocument())
    expect(String(fn.mock.calls[0]?.[0])).toContain("/api/v1/auth/forgot-username")
  })

  it("toggles between password and username reminder modes", () => {
    render(<ForgotPasswordPage />)
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Forgot your username instead?" }))
    expect(screen.getByRole("button", { name: "Send username" })).toBeInTheDocument()
  })
})
