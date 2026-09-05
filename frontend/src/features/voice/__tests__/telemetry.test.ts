import { afterEach, describe, expect, it, vi } from "vitest"

import { reportCueFired, reportCueSuppressed } from "../telemetry"

afterEach(() => {
  vi.unstubAllGlobals()
})

function lastRequestBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as unknown as [
    string,
    RequestInit,
  ]
  return JSON.parse(init.body as string) as Record<string, unknown>
}

describe("reportCueFired", () => {
  it("POSTs a fired event with fault id, severity, and persona", () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)

    reportCueFired({ faultId: "squat.knee_angle.high", severity: "high", persona: "atlas" })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain("/api/v1/voice/events")
    expect(init.method).toBe("POST")
    expect(init.keepalive).toBe(true)

    const body = lastRequestBody(fetchMock)
    expect(body.events).toEqual([
      {
        event: "fired",
        fault_id: "squat.knee_angle.high",
        severity: "high",
        persona: "atlas",
        latency_ms: undefined,
      },
    ])
  })

  it("includes latency_ms when provided", () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)

    reportCueFired({ faultId: "deadlift.hip_angle.high", severity: "medium", latencyMs: 212.4 })

    const body = lastRequestBody(fetchMock)
    expect((body.events as { latency_ms: number }[])[0].latency_ms).toBe(212.4)
  })

  it("never throws when the network request fails (fire-and-forget)", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch")
      }),
    )

    expect(() => reportCueFired({ faultId: "curl.elbow_angle.low", severity: "low" })).not.toThrow()
  })
})

describe("reportCueSuppressed", () => {
  it("POSTs a suppressed event with fault id and reason", () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)

    reportCueSuppressed({ faultId: "bench.shoulder_angle.low", reason: "fault_cooldown", persona: "vector" })

    const body = lastRequestBody(fetchMock)
    expect(body.events).toEqual([
      {
        event: "suppressed",
        fault_id: "bench.shoulder_angle.low",
        reason: "fault_cooldown",
        persona: "vector",
      },
    ])
  })

  it("never throws when the network request fails (fire-and-forget)", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch")
      }),
    )

    expect(() =>
      reportCueSuppressed({ faultId: "ohp.elbow_angle.high", reason: "min_interval" }),
    ).not.toThrow()
  })
})
