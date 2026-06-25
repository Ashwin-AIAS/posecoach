import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SettingsPanel } from "../components/SettingsPanel"
import type { AuthUser, useAuth } from "../hooks/useAuth"

type AuthHook = ReturnType<typeof useAuth>

const USER: AuthUser = {
  id: "u1",
  email: "lifter@example.com",
  created_at: "2026-01-01T00:00:00Z",
}

function makeAuth(partial: Partial<AuthHook> = {}): AuthHook {
  return {
    user: null,
    state: "anonymous",
    error: null,
    login: vi.fn(async () => {}),
    register: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
    ...partial,
  }
}

afterEach(() => {
  window.localStorage.clear()
})

describe("SettingsPanel", () => {
  it("shows a Sign in button when anonymous", () => {
    render(<SettingsPanel auth={makeAuth()} onNavigateCoach={vi.fn()} />)

    expect(screen.getByTestId("settings-signin-btn")).toBeInTheDocument()
    expect(screen.queryByTestId("settings-email")).not.toBeInTheDocument()
    expect(screen.queryByTestId("delete-account-btn")).not.toBeInTheDocument()
  })

  it("shows the email and a working Log out button when authenticated", () => {
    const logout = vi.fn(async () => {})
    render(
      <SettingsPanel
        auth={makeAuth({ state: "authenticated", user: USER, logout })}
        onNavigateCoach={vi.fn()}
      />,
    )

    expect(screen.getByTestId("settings-email")).toHaveTextContent("lifter@example.com")
    fireEvent.click(screen.getByTestId("settings-logout-btn"))
    expect(logout).toHaveBeenCalled()
  })

  it("persists the units preference to localStorage", () => {
    render(<SettingsPanel auth={makeAuth()} onNavigateCoach={vi.fn()} />)

    expect(screen.getByTestId("unit-kg")).toHaveAttribute("aria-checked", "true")
    fireEvent.click(screen.getByTestId("unit-lb"))

    expect(screen.getByTestId("unit-lb")).toHaveAttribute("aria-checked", "true")
    expect(window.localStorage.getItem("pc.units")).toBe("lb")
  })

  it("requires a confirm step before deleting the account", async () => {
    const deleteAccount = vi.fn(async () => {})
    const onNavigateCoach = vi.fn()
    render(
      <SettingsPanel
        auth={makeAuth({ state: "authenticated", user: USER, deleteAccount })}
        onNavigateCoach={onNavigateCoach}
      />,
    )

    // First click reveals a confirm — it must NOT delete immediately.
    expect(screen.queryByTestId("delete-confirm")).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId("delete-account-btn"))
    expect(screen.getByTestId("delete-confirm")).toBeInTheDocument()
    expect(deleteAccount).not.toHaveBeenCalled()

    // Confirming calls the existing endpoint and returns to Coach.
    fireEvent.click(screen.getByTestId("confirm-delete-btn"))
    await waitFor(() => expect(deleteAccount).toHaveBeenCalled())
    await waitFor(() => expect(onNavigateCoach).toHaveBeenCalled())
  })
})
