import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useCoachVoice } from "../useCoachVoice"

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })
}

describe("useCoachVoice manifest handling (P29 S8)", () => {
  it("becomes ready and exposes resolveFaultId when the manifest version matches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          version: 2,
          clips: { "atlas.squat.knee_angle.high.left": { file: "a.mp3", hash: "h", dur_ms: 500 } },
          faults: { "squat::Squat deeper for full range": "squat.knee_angle.high" },
        }),
      ),
    )

    const { result } = renderHook(() => useCoachVoice())
    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(result.current.resolveFaultId("squat", "Squat deeper for full range")).toBe(
      "squat.knee_angle.high",
    )
    expect(result.current.resolveFaultId("squat", "Not a real cue")).toBeNull()
  })

  it("stays not-ready on a stale (wrong-version) manifest — treated like 'not generated yet'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ version: 1, clips: {}, faults: {} })),
    )

    const { result } = renderHook(() => useCoachVoice())
    // Give the fetch microtask a turn without ever expecting `ready` to flip.
    await Promise.resolve()
    await Promise.resolve()

    expect(result.current.ready).toBe(false)
    expect(result.current.resolveFaultId("squat", "Squat deeper for full range")).toBeNull()
  })

  it("stays not-ready when the manifest fetch fails outright", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    )

    const { result } = renderHook(() => useCoachVoice())
    await Promise.resolve()
    await Promise.resolve()

    expect(result.current.ready).toBe(false)
  })
})
