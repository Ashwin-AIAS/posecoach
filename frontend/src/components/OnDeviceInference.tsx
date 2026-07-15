import { memo, useRef, useState } from "react"
import { Check, Copy, Cpu, XCircle } from "lucide-react"

import type { PocSummary } from "../hooks/useOnDeviceInference"
import { useOnDeviceInference } from "../hooks/useOnDeviceInference"
import type { StageStats } from "../hooks/useLatencyProbe"
import { Icon } from "./ui/Icon"

/**
 * On-device inference panel (P32). Dev-flagged Settings section that loads the
 * production 640 ONNX into the browser (WebGPU → wasm fallback), times ~50 real
 * camera frames, and checks one frame's keypoints against the live server.
 * The 66 ms/frame budget (15 FPS) is the pass line the plan cares about.
 */

const FRAME_BUDGET_MS = 66

const STAGE_ROWS: readonly { readonly key: keyof PocSummary["stages"]; readonly label: string }[] =
  [
    { key: "preprocess", label: "Preprocess (letterbox + tensor)" },
    { key: "inference", label: "Inference" },
    { key: "total", label: "Total per frame" },
  ]

function StatCell({ value }: { readonly value: number }): JSX.Element {
  return <td className="hud-numerals px-2 py-1 text-right text-xs text-gray-200">{value}</td>
}

function ResultsTable({ summary }: { readonly summary: PocSummary }): JSX.Element {
  const withinBudget = summary.stages.total.p95_ms < FRAME_BUDGET_MS
  const sanity = summary.sanity
  return (
    <div data-testid="ondevice-results">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-sm font-medium text-gray-100">
          <span className="hud-numerals">{summary.stages.total.p50_ms}</span> ms/frame p50 ·{" "}
          <span className="hud-numerals">{summary.fps_inference_only}</span> FPS
        </p>
        <span
          className={
            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
            (withinBudget ? "bg-score-good/15 text-score-good" : "bg-score-mid/15 text-score-mid")
          }
          data-testid="ondevice-budget"
        >
          {withinBudget ? "within 66 ms budget" : "over 66 ms budget"}
        </span>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        <span className="hud-numerals">{summary.ep_used}</span> execution provider
        {summary.ep_used === "wasm" ? ` (SIMD, ${summary.wasm_threads} thread)` : ""} · model{" "}
        <span className="hud-numerals">{(summary.model_bytes / 1_000_000).toFixed(1)}</span> MB
        fetched in <span className="hud-numerals">{Math.round(summary.model_fetch_ms)}</span> ms ·
        session <span className="hud-numerals">{Math.round(summary.session_create_ms)}</span> ms ·
        first warm-up run <span className="hud-numerals">{Math.round(summary.warmup_first_run_ms)}</span> ms
      </p>
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
      <p className="mt-2 text-xs text-gray-500">
        Person detected in{" "}
        <span className="hud-numerals">
          {summary.detected_frames}/{summary.frames}
        </span>{" "}
        frames.
      </p>
      <p className="mt-1 text-xs text-gray-400" data-testid="ondevice-sanity">
        {sanity.error !== null ? (
          <>Parity check failed: {sanity.error}</>
        ) : (
          <>
            Parity vs server: mean Δ{" "}
            <span className="hud-numerals">{sanity.mean_px_delta}</span> px across{" "}
            {sanity.joints_compared} joints ({sanity.frame_w}×{sanity.frame_h} frame, server{" "}
            {sanity.server_status}
            {sanity.server_latency_ms !== null ? (
              <>
                , <span className="hud-numerals">{sanity.server_latency_ms}</span> ms
              </>
            ) : null}
            )
          </>
        )}
      </p>
    </div>
  )
}

function OnDeviceInferenceInner(): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const poc = useOnDeviceInference(videoRef)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  const busy = poc.phase === "loading" || poc.phase === "running" || poc.phase === "sanity"
  const json = poc.summary !== null ? JSON.stringify(poc.summary, null, 2) : null

  const onCopy = async (): Promise<void> => {
    if (json === null) return
    setCopyError(false)
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyError(true)
    }
  }

  return (
    <div data-testid="ondevice-panel">
      <p className="text-xs leading-relaxed text-gray-500">
        Loads the production 640 ONNX into this browser (WebGPU, wasm fallback) and times ~
        {poc.total} camera frames end-to-end on this device — the decision input for moving pose
        inference on-device. Frames never leave this device; one frame is sent to the server
        only for the keypoint parity check.
      </p>

      <video
        ref={videoRef}
        playsInline
        muted
        className={"mt-3 h-28 rounded-xl bg-black " + (busy ? "" : "hidden")}
        data-testid="ondevice-preview"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => (busy ? poc.cancel() : poc.start())}
          className={
            "flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none " +
            (busy ? "text-score-bad" : "text-gray-200 hover:text-white")
          }
          data-testid="ondevice-run"
        >
          <Icon icon={busy ? XCircle : Cpu} size={15} />
          {busy ? "Cancel" : poc.phase === "done" ? "Run again" : "Run on-device test"}
        </button>

        {busy && (
          <p className="text-xs text-gray-400" data-testid="ondevice-progress" aria-live="polite">
            {poc.phase === "running" ? (
              <>
                Frame <span className="hud-numerals">{poc.completed}</span>/{poc.total}
              </>
            ) : (
              poc.step
            )}
          </p>
        )}
      </div>

      {poc.error !== null && (
        <p className="mt-3 text-xs text-score-bad" data-testid="ondevice-error">
          {poc.error}
        </p>
      )}

      {poc.summary !== null && (
        <div className="mt-4">
          <ResultsTable summary={poc.summary} />
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void onCopy()}
              className="flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium text-gray-200 shadow-elev-1 transition ease-spring hover:-translate-y-0.5 hover:text-white active:translate-y-0 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
              data-testid="ondevice-copy"
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
              data-testid="ondevice-json"
            >
              {json}
            </pre>
          </details>
        </div>
      )}
    </div>
  )
}

export const OnDeviceInference = memo(OnDeviceInferenceInner)
