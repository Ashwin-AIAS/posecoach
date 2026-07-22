import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ResetPasswordPage } from "../components/ResetPasswordPage"

function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal("fetch", fn)
  return fn
}

beforeEach(() => {
  window.history.replaceState(null, "", "/reset-password?token=abc123")
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ResetPasswordPage", () => {
  it("shows an invalid-link message when the token is missing", () => {
    window.history.replaceState(null, "", "/reset-password")
    render(<ResetPasswordPage />)
    expect(screen.getByTestId("reset-invalid")).toBeInTheDocument()
    expect(screen.queryByTestId("reset-form")).not.toBeInTheDocument()
  })

  it("renders the two-password form when a token is present", () => {
    render(<ResetPasswordPage />)
    expect(screen.getByTestId("reset-form")).toBeInTheDocument()
    expect(screen.getByLabelText("New password")).toBeInTheDocument()
    expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument()
  })

  it("blocks submit when the passwords don't match", async () => {
    const fn = mockFetch(200, { message: "updated" })
    render(<ResetPasswordPage />)
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "password123" } })
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "password999" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Update password" }))

    await waitFor(() => expect(screen.getByTestId("reset-error")).toBeInTheDocument())
    expect(screen.getByTestId("reset-error").textContent).toMatch(/don't match/i)
    expect(fn).not.toHaveBeenCalled()
  })

  it("blocks submit when the password is too short", async () => {
    const fn = mockFetch(200, { message: "updated" })
    render(<ResetPasswordPage />)
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "short" } })
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "short" } })
    fireEvent.click(screen.getByRole("button", { name: "Update password" }))

    await waitFor(() => expect(screen.getByTestId("reset-error")).toBeInTheDocument())
    expect(fn).not.toHaveBeenCalled()
  })

  it("submits a valid matching password and shows the success screen", async () => {
    const fn = mockFetch(200, { message: "updated" })
    render(<ResetPasswordPage />)
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "newpassword2" } })
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "newpassword2" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Update password" }))

    await waitFor(() => expect(screen.getByTestId("reset-success")).toBeInTheDocument())
    const [url, init] = fn.mock.calls[0] ?? []
    expect(String(url)).toContain("/api/v1/auth/reset-password")
    expect(JSON.parse(String(init?.body))).toEqual({ token: "abc123", new_password: "newpassword2" })
    expect(screen.getByTestId("reset-go-signin")).toHaveAttribute("href", "/")
  })

  it("surfaces the backend rejection for an expired/used token", async () => {
    mockFetch(400, { detail: "This reset link is invalid or has expired." })
    render(<ResetPasswordPage />)
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "newpassword2" } })
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "newpassword2" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Update password" }))

    await waitFor(() => expect(screen.getByTestId("reset-error")).toBeInTheDocument())
    expect(screen.getByTestId("reset-error").textContent).toMatch(/invalid or has expired/i)
  })
})
