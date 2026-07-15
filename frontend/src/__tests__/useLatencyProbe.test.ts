import { afterEach, describe, expect, it } from "vitest"

import {
  buildSample,
  getProbeWsUrl,
  isLatencyDiagEnabled,
  percentile,
  summarize,
  type ProbeSample,
} from "../hooks/useLatencyProbe"

afterEach(() => {
  window.localStorage.clear()
})

describe("percentile", () => {
  it("returns 0 for an empty list", () => {
    expect(percentile([], 0.5)).toBe(0)
  })

  it("returns the single value regardless of pct", () => {
    expect(percentile([42], 0.5)).toBe(42)
    expect(percentile([42], 0.95)).toBe(42)
  })

  it("linearly interpolates between ranks", () => {
    // rank = (4-1)*0.5 = 1.5 → 20 + (30-20)*0.5
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25)
  })

  it("sorts internally — input order does not matter", () => {
    expect(percentile([40, 10, 30, 20], 0.5)).toBe(25)
  })

  it("p95 of 1..100 lands near the top of the range", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(percentile(values, 0.95)).toBeCloseTo(95.05, 5)
  })
})

describe("buildSample", () => {
  it("splits RTT into server and network shares", () => {
    const s = buildSample(0, 4.2, 100, { latency_ms: 60, status: "ok" })
    expect(s).toEqual({
      seq: 0,
      encode_ms: 4.2,
      rtt_ms: 100,
      server_ms: 60,
      network_ms: 40,
      status: "ok",
    })
  })

  it("clamps a negative network share to 0", () => {
    // Clock skew / rounding can make server latency exceed the measured RTT.
    const s = buildSample(1, 3, 50, { latency_ms: 55, status: "ok" })
    expect(s.network_ms).toBe(0)
  })

  it("records null server/network when latency is unreported (no_person sends 0)", () => {
    const s = buildSample(2, 3, 90, { latency_ms: 0, status: "no_person" })
    expect(s.server_ms).toBeNull()
    expect(s.network_ms).toBeNull()
    expect(s.status).toBe("no_person")
  })

  it("marks frame-level error replies", () => {
    const s = buildSample(3, 3, 20, { error: "frame too large" })
    expect(s.status).toBe("error")
    expect(s.server_ms).toBeNull()
  })
})

describe("summarize", () => {
  const sample = (seq: number, rtt: number, server: number | null, status: string): ProbeSample => ({
    seq,
    encode_ms: 4,
    rtt_ms: rtt,
    server_ms: server,
    network_ms: server === null ? null : Math.max(0, rtt - server),
    status,
  })

  const OPTS = {
    url: "wss://example.test/ws/inference",
    startedAtIso: "2026-07-15T12:00:00.000Z",
    durationMs: 2000,
    framesRequested: 4,
    userAgent: "vitest",
  }

  it("computes effective FPS from completed frames over the run duration", () => {
    const samples = [
      sample(0, 100, 60, "ok"),
      sample(1, 120, 70, "ok"),
      sample(2, 110, 65, "ok"),
      sample(3, 90, null, "no_person"),
    ]
    const summary = summarize(samples, OPTS)
    expect(summary.effective_fps).toBe(2) // 4 frames / 2s
    expect(summary.frames_completed).toBe(4)
    expect(summary.duration_s).toBe(2)
  })

  it("excludes unreported-server frames from server/network stats but not RTT", () => {
    const samples = [
      sample(0, 100, 60, "ok"),
      sample(1, 120, 70, "ok"),
      sample(2, 110, 65, "ok"),
      sample(3, 90, null, "no_person"),
    ]
    const summary = summarize(samples, OPTS)
    expect(summary.stages.rtt.n).toBe(4)
    expect(summary.stages.server.n).toBe(3)
    expect(summary.stages.network.n).toBe(3)
    expect(summary.stages.server.p50_ms).toBe(65)
    expect(summary.status_counts).toEqual({ ok: 3, no_person: 1 })
  })

  it("carries run metadata and the raw samples through to the JSON payload", () => {
    const samples = [sample(0, 100, 60, "ok")]
    const summary = summarize(samples, OPTS)
    expect(summary.url).toBe(OPTS.url)
    expect(summary.started_at).toBe(OPTS.startedAtIso)
    expect(summary.frames_requested).toBe(4)
    expect(summary.samples).toHaveLength(1)
    expect(summary.capture.long_side).toBe(512)
    expect(summary.capture.exercise).toBe("squat")
  })

  it("is safe on an empty run", () => {
    const summary = summarize([], { ...OPTS, durationMs: 0 })
    expect(summary.effective_fps).toBe(0)
    expect(summary.stages.rtt).toEqual({ n: 0, p50_ms: 0, p95_ms: 0, mean_ms: 0 })
  })
})

describe("getProbeWsUrl", () => {
  it("builds a same-origin ws URL from window.location when no env override", () => {
    // vitest jsdom origin is http://localhost:3000 by default.
    const url = getProbeWsUrl()
    expect(url.startsWith("ws")).toBe(true)
    expect(url.endsWith("/ws/inference")).toBe(true)
  })
})

describe("isLatencyDiagEnabled", () => {
  it("is enabled via the persisted local flag", () => {
    window.localStorage.setItem("pc.latencyDiag", "1")
    expect(isLatencyDiagEnabled()).toBe(true)
  })

  it("is enabled in dev builds (vitest runs as a dev build)", () => {
    expect(isLatencyDiagEnabled()).toBe(true)
  })
})
