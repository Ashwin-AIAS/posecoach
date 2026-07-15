import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { LatencyDiagnostics } from "../components/LatencyDiagnostics"

afterEach(() => {
  window.localStorage.clear()
})

describe("LatencyDiagnostics", () => {
  it("renders idle with a run button and no results", () => {
    render(<LatencyDiagnostics />)

    expect(screen.getByTestId("latency-diag-run")).toHaveTextContent("Run latency probe")
    expect(screen.queryByTestId("latency-diag-results")).not.toBeInTheDocument()
    expect(screen.queryByTestId("latency-diag-error")).not.toBeInTheDocument()
  })

  it("surfaces a friendly error when no camera is available (jsdom)", async () => {
    render(<LatencyDiagnostics />)

    fireEvent.click(screen.getByTestId("latency-diag-run"))

    // jsdom has no navigator.mediaDevices — the probe must fail cleanly, not hang.
    // Generous timeout: the assertion resolves in ms, but waitFor's 1s default
    // is tight enough to flake when the machine is under heavy disk load.
    await waitFor(
      () =>
        expect(screen.getByTestId("latency-diag-error")).toHaveTextContent(
          "Camera not available in this browser",
        ),
      { timeout: 5000 },
    )
    // And return to a runnable state.
    expect(screen.getByTestId("latency-diag-run")).toHaveTextContent("Run latency probe")
  })
})
