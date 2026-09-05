/**
 * Cue telemetry beacon (P29 S7) — fire-and-forget reports to
 * `POST /api/v1/voice/events`, which logs the exact structlog events the
 * thesis pipeline greps for (spec §11): `voice_cue_fired`,
 * `voice_cue_suppressed`, and — only on a fired report carrying one —
 * `voice_cue_latency_ms`. See `app/voice/router.py`'s `record_cue_events`
 * for the server-side shape and behaviour this mirrors.
 *
 * Deliberately does not throw: a lost beacon is a missed data point for the
 * thesis eval, never a reason to break or delay a coaching session. Every
 * call is best-effort and swallows its own errors.
 */
import { apiFetch } from "../../lib/api"

import type { Severity } from "./playbackManager"

export interface CueFiredReport {
  readonly faultId: string
  readonly severity: Severity
  readonly persona?: string
  /** Rep-boundary -> audio-start latency in ms, when known (spec §11 target: p95 < 400ms). */
  readonly latencyMs?: number
}

export interface CueSuppressedReport {
  readonly faultId: string
  readonly reason: string
  readonly persona?: string
}

interface VoiceCueEventBody {
  readonly event: "fired" | "suppressed"
  readonly fault_id: string
  readonly persona?: string
  readonly severity?: Severity
  readonly reason?: string
  readonly latency_ms?: number
}

function send(events: readonly VoiceCueEventBody[]): void {
  void apiFetch("/api/v1/voice/events", {
    method: "POST",
    body: JSON.stringify({ events }),
    // Lets the browser finish this small POST even if the page is being
    // unloaded (e.g. the user navigates away mid-set) — never worth
    // delaying navigation to wait for it.
    keepalive: true,
  }).catch(() => {
    // Best-effort beacon — see module doc comment.
  })
}

/** Report one cue the arbiter decided to speak (or would have, if muted). */
export function reportCueFired(report: CueFiredReport): void {
  send([
    {
      event: "fired",
      fault_id: report.faultId,
      severity: report.severity,
      persona: report.persona,
      latency_ms: report.latencyMs,
    },
  ])
}

/** Report one cue the arbiter suppressed, and why (spec §4's rule table reasons). */
export function reportCueSuppressed(report: CueSuppressedReport): void {
  send([
    {
      event: "suppressed",
      fault_id: report.faultId,
      reason: report.reason,
      persona: report.persona,
    },
  ])
}
