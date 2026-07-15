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
    await waitFor(() =>
      expect(screen.getByTestId("latency-diag-error")).toHaveTextContent(
        "Camera not available in this browser",
      ),
    )
    // And return to a runnable state.
    expect(screen.getByTestId("latency-diag-run")).toHaveTextContent("Run latency probe")
  })
})
