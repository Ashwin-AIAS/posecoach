import { memo, useRef, useState } from "react"
import { Activity, Check, Copy, XCircle } from "lucide-react"

import type { ProbeSummary, StageStats } from "../hooks/useLatencyProbe"
import { useLatencyProbe } from "../hooks/useLatencyProbe"
import { Icon } from "./ui/Icon"

/**
 * Latency Diagnostics panel (P31). Dev-flagged Settings section that runs the
 * useLatencyProbe against this deployment's /ws/inference and shows where each
 * frame's round-trip goes: JPEG encode vs server inference vs network+overhead.
 * Results are copyable as JSON for the thesis latency chapter.
 */

const STAGE_ROWS: readonly { readonly key: keyof ProbeSummary["stages"]; readonly label: string }[] =
  [
    { key: "encode", label: "JPEG encode" },
    { key: "rtt", label: "Round-trip" },
    { key: "server", label: "Server (inference)" },
    { key: "network", label: "Network + overhead" },
  ]

function StatCell({ value }: { readonly value: number }): JSX.Element {
  return <td className="hud-numerals px-2 py-1 text-right text-xs text-gray-200">{value}</td>
}

function ResultsTable({ summary }: { readonly summary: ProbeSummary }): JSX.Element {
  const noPerson = summary.status_counts["no_person"] ?? 0
  return (
    <div data-testid="latency-diag-results">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-sm font-medium text-gray-100">
          <span className="hud-numerals">{summary.effective_fps}</span> FPS effective
        </p>
        <p className="text-xs text-gray-500">
          {summary.frames_completed}/{summary.frames_requested} frames in{" "}
          <span className="hud-numerals">{summary.duration_s}</span>s
        </p>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[280px] border-collapse">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.14em] text-gray-500">
              <th className="px-2 py-1 text-left font-medium">Stage (ms)</th>
              <th className="px-2 py-1 text-right font-medium">p50</th>
              <th className="px-2 py-1 text-right font-medium">p95</th>
              <th className="px-2 py-1 text-right font-medium">mean</th>
            </tr>
          </thead>
          <tbody>
            {STAGE_ROWS.map(({ key, label }) => {
              const s: StageStats = summary.stages[key]
              return (
                <tr key={key} className="border-t border-surface-hairline">
                  <td className="px-2 py-1 text-left text-xs text-gray-400">{label}</td>
                  <StatCell value={s.p50_ms} />
                  <StatCell value={s.p95_ms} />
                  <StatCell value={s.mean_ms} />
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {noPerson > 0 && (
        <p className="mt-2 text-xs text-score-mid">
          {noPerson} frame{noPerson === 1 ? "" : "s"} had no person in view — those are excluded
          from the server / network rows. Stand in frame for a cleaner run.
        </p>
      )}
    </div>
  )
}

function LatencyDiagnosticsInner(): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const probe = useLatencyProbe(videoRef)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  const busy = probe.phase === "preparing" || probe.phase === "running"
  const json = probe.summary !== null ? JSON.stringify(probe.summary, null, 2) : null

  const onCopy = async (): Promise<void> => {
    if (json === null) return
    setCopyError(false)
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked (permissions / insecure context) — the JSON below is
      // still selectable by hand.
      setCopyError(true)
    }
  }

  return (
    <div data-testid="latency-diag">
      <p className="text-xs leading-relaxed text-gray-500">
        Sends {probe.total} camera frames to this deployment&apos;s pose endpoint (one in flight,
        like a live session) and breaks each round-trip into encode, server inference, and
        network share. Frames are processed in memory and never stored.
      </p>

      {/* Small live preview — the user needs to see they are in frame. Always
          mounted so the ref is stable; hidden unless a run is active. */}
      <video
        ref={videoRef}
        playsInline
        muted
        className={"mt-3 h-28 rounded-xl bg-black " + (busy ? "" : "hidden")}
        data-testid="latency-diag-preview"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => (busy ? probe.cancel() : probe.start())}
          className={
            "flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none " +
            (busy ? "text-score-bad" : "text-gray-200 hover:text-white")
          }
          data-testid="latency-diag-run"
        >
          <Icon icon={busy ? XCircle : Activity} size={15} />
          {busy ? "Cancel" : probe.phase === "done" ? "Run again" : "Run latency probe"}
        </button>

        {busy && (
          <p className="text-xs text-gray-400" data-testid="latency-diag-progress" aria-live="polite">
            {probe.phase === "preparing" ? (
              "Starting camera + connection…"
            ) : (
              <>
                Frame <span className="hud-numerals">{probe.completed}</span>/{probe.total}
              </>
            )}
          </p>
        )}
      </div>

      {probe.error !== null && (
        <p className="mt-3 text-xs text-score-bad" data-testid="latency-diag-error">
          {probe.error}
        </p>
      )}

      {probe.summary !== null && (
        <div className="mt-4">
          <ResultsTable summary={probe.summary} />
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void onCopy()}
              className="flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium text-gray-200 shadow-elev-1 transition ease-spring hover:-translate-y-0.5 hover:text-white active:translate-y-0 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
              data-testid="latency-diag-copy"
            >
              <Icon icon={copied ? Check : Copy} size={15} />
              {copied ? "Copied" : "Copy JSON"}
            </button>
            {copyError && (
              <p className="text-xs text-score-mid">Clipboard blocked — copy from below.</p>
            )}
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              Raw JSON
            </summary>
            <pre
              className="mt-2 max-h-64 overflow-auto rounded-xl bg-surface-base p-3 text-[10px] leading-relaxed text-gray-400"
              data-testid="latency-diag-json"
            >
              {json}
            </pre>
          </details>
        </div>
      )}
    </div>
  )
}

export const LatencyDiagnostics = memo(LatencyDiagnosticsInner)
