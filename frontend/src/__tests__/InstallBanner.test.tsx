import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { InstallBanner } from "../components/InstallBanner"

/** Point navigator.userAgent at an iPhone (jsdom default is a desktop UA). */
function mockIphoneUserAgent(): void {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe("InstallBanner", () => {
  it("renders nothing on a desktop browser that never fired beforeinstallprompt", () => {
    render(<InstallBanner />)
    expect(screen.queryByTestId("install-banner")).not.toBeInTheDocument()
  })

  it("shows Share → Add to Home Screen instructions on iOS (no install API exists)", () => {
    mockIphoneUserAgent()
    render(<InstallBanner />)
    expect(screen.getByTestId("ios-install-hint")).toBeInTheDocument()
    expect(screen.getByText("Add to Home Screen")).toBeInTheDocument()
    // No Install button on iOS — there is no programmatic install to trigger.
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument()
  })

  it("offsets its bottom by the tab-bar height so it clears the bottom tab bar", () => {
    mockIphoneUserAgent()
    render(<InstallBanner />)
    // Wired to the TabBar's published height; the var falls back to 0px when no
    // bar is present, so this never regresses the live-set (no-bar) spacing.
    expect(screen.getByTestId("install-banner").getAttribute("style")).toContain("--tabbar-h")
  })

  it("hides after dismissal and persists it across remounts", () => {
    mockIphoneUserAgent()
    const { unmount } = render(<InstallBanner />)
    fireEvent.click(screen.getByRole("button", { name: "Dismiss install prompt" }))
    expect(screen.queryByTestId("install-banner")).not.toBeInTheDocument()

    // Remount (next visit) — dismissal was persisted, banner must not nag again.
    unmount()
    render(<InstallBanner />)
    expect(screen.queryByTestId("install-banner")).not.toBeInTheDocument()
  })

  it("does not render iOS instructions when already running standalone", () => {
    mockIphoneUserAgent()
    // iOS home-screen launches expose navigator.standalone === true.
    Object.defineProperty(window.navigator, "standalone", {
      value: true,
      configurable: true,
    })
    render(<InstallBanner />)
    expect(screen.queryByTestId("install-banner")).not.toBeInTheDocument()
    // Cleanup the non-standard property so other tests see pristine navigator.
    delete (window.navigator as Navigator & { standalone?: boolean }).standalone
  })
})
