import { memo } from "react"

import type { ConnectionState, PoseResult } from "../types"
import { jointLabel, scoreColor } from "../lib/skeleton"

interface CoachingCuesProps {
  readonly result: PoseResult | null
  readonly connectionState: ConnectionState
  readonly error: string | null
}

const STATE_LABEL: Record<ConnectionState, string> = {
  idle: "Idle",
  connecting: "Connecting…",
  open: "Live",
  closed: "Disconnected",
  error: "Error",
}

const STATE_DOT: Record<ConnectionState, string> = {
  idle: "bg-gray-500",
  connecting: "bg-score-mid animate-pulse-dot",
  open: "bg-score-good",
  closed: "bg-score-bad",
  error: "bg-score-bad",
}

function ConnectionPill({ state }: { state: ConnectionState }): JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-surface-hairline bg-surface-base/60 px-2.5 py-1 text-[11px] font-medium text-gray-300"
      data-testid="connection-pill"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[state]}`} aria-hidden="true" />
      {STATE_LABEL[state]}
    </span>
  )
}

function JointBar({ name, value }: { name: string; value: number }): JSX.Element {
  const color = scoreColor(value)
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[11px] text-gray-400">{jointLabel(name)}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-hairline">
        <div
          className="h-full rounded-full transition-[width] duration-300 ease-out"
          style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }}
        />
      </div>
      <span className="hud-numerals w-6 shrink-0 text-right text-[11px] text-gray-400">{Math.round(value)}</span>
    </div>
  )
}

function CoachingCuesInner({ result, connectionState, error }: CoachingCuesProps): JSX.Element {
  const score = result?.score ?? null
  const cues = result?.cues ?? []
  const holdS = result?.hold_s
  const latency = result?.latency_ms ?? null
  const jointScores = result?.joint_scores ?? {}
  // Worst joints first — surface the problem areas.
  const joints = Object.entries(jointScores).sort((a, b) => a[1] - b[1])

  return (
    <section className="rounded-2xl border border-surface-hairline bg-surface-raised/70 p-4 shadow-card backdrop-blur-md">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">Form score</h2>
        <ConnectionPill state={connectionState} />
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span
          className="hud-numerals font-display text-6xl font-semibold leading-none transition-colors duration-300"
          style={{ color: scoreColor(score) }}
          data-testid="score-value"
        >
          {score === null ? "—" : Math.round(score)}
        </span>
        <span className="text-sm text-gray-600">/ 100</span>
        {holdS !== undefined && (
          <span
            className="ml-auto rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent"
            data-testid="hold-timer"
          >
            Hold {holdS.toFixed(1)}s
          </span>
        )}
      </div>

      {joints.length > 0 && (
        <div className="mt-4 space-y-1.5" data-testid="joint-bars">
          {joints.map(([name, value]) => (
            <JointBar key={name} name={name} value={value} />
          ))}
        </div>
      )}

      {cues.length > 0 && (
        <ul className="mt-4 space-y-1.5" data-testid="cues-list">
          {cues.map((cue) => (
            <li
              key={cue}
              className="flex animate-caption-in items-start gap-2 text-sm text-gray-100"
            >
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
              {cue}
            </li>
          ))}
        </ul>
      )}

      {error !== null && (
        <p className="mt-3 text-sm text-score-bad" data-testid="error-msg">
          {error}
        </p>
      )}

      {latency !== null && (
        <p className="mt-3 text-[11px] text-gray-600" data-testid="latency-display">
          Latency {Math.round(latency)} ms
        </p>
      )}
    </section>
  )
}

export const CoachingCues = memo(CoachingCuesInner)
