import { memo } from "react"

import type { ConnectionState, PoseResult } from "../types"
import { scoreColor } from "../lib/skeleton"

interface CoachingCuesProps {
  readonly result: PoseResult | null
  readonly connectionState: ConnectionState
  readonly error: string | null
}

function ConnectionPill({ state }: { state: ConnectionState }): JSX.Element {
  const label: Record<ConnectionState, string> = {
    idle: "Idle",
    connecting: "Connecting…",
    open: "Live",
    closed: "Disconnected",
    error: "Error",
  }
  const color: Record<ConnectionState, string> = {
    idle: "bg-gray-600",
    connecting: "bg-yellow-600",
    open: "bg-green-600",
    closed: "bg-red-700",
    error: "bg-red-700",
  }
  return (
    <span className={`text-xs px-2 py-1 rounded ${color[state]}`} data-testid="connection-pill">
      {label[state]}
    </span>
  )
}

function CoachingCuesInner({ result, connectionState, error }: CoachingCuesProps): JSX.Element {
  const score = result?.score ?? null
  const cues = result?.cues ?? []
  const holdS = result?.hold_s
  const latency = result?.latency_ms ?? null

  return (
    <div className="bg-gray-900 bg-opacity-90 text-white p-4 rounded-lg shadow-lg space-y-3">
      <div className="flex justify-between items-center">
        <h2 className="text-sm uppercase tracking-wide text-gray-400">Form score</h2>
        <ConnectionPill state={connectionState} />
      </div>

      <div className="flex items-baseline gap-3">
        <span
          className="text-5xl font-bold tabular-nums"
          style={{ color: scoreColor(score) }}
          data-testid="score-value"
        >
          {score === null ? "—" : Math.round(score)}
        </span>
        <span className="text-sm text-gray-500">/ 100</span>
        {holdS !== undefined && (
          <span className="ml-auto text-xs text-gray-400" data-testid="hold-timer">
            Hold: {holdS.toFixed(1)}s
          </span>
        )}
      </div>

      {cues.length > 0 && (
        <ul className="space-y-1" data-testid="cues-list">
          {cues.map((cue) => (
            <li key={cue} className="text-base text-amber-300">
              {cue}
            </li>
          ))}
        </ul>
      )}

      {error !== null && (
        <p className="text-sm text-red-400" data-testid="error-msg">
          {error}
        </p>
      )}

      {latency !== null && (
        <p className="text-xs text-gray-500" data-testid="latency-display">
          Latency: {Math.round(latency)} ms
        </p>
      )}
    </div>
  )
}

export const CoachingCues = memo(CoachingCuesInner)
