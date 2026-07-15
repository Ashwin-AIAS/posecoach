import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { OnDeviceInference } from "../components/OnDeviceInference"

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe("OnDeviceInference", () => {
  it("renders idle with a run button and no results", () => {
    render(<OnDeviceInference />)

    expect(screen.getByTestId("ondevice-run")).toHaveTextContent("Run on-device test")
    expect(screen.queryByTestId("ondevice-results")).not.toBeInTheDocument()
    expect(screen.queryByTestId("ondevice-error")).not.toBeInTheDocument()
  })

  it("surfaces a friendly error when the model endpoint is unavailable", async () => {
    // The very first step is the model fetch — make it fail deterministically
    // so the run never reaches ORT/camera (neither exists in jsdom).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404 })),
    )
    render(<OnDeviceInference />)

    fireEvent.click(screen.getByTestId("ondevice-run"))

    // Generous timeout: the assertion resolves in ms, but waitFor's 1s default
    // is tight enough to flake when the machine is under heavy disk load.
    await waitFor(
      () =>
        expect(screen.getByTestId("ondevice-error")).toHaveTextContent(
          "Model endpoint returned 404",
        ),
      { timeout: 5000 },
    )
    // And return to a runnable state.
    expect(screen.getByTestId("ondevice-run")).toHaveTextContent("Run on-device test")
  })
})
