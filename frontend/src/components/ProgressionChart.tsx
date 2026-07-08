import { memo } from "react"

import type { SessionPoint } from "../lib/progression"
import type { Unit } from "../hooks/useUnitPref"

const W = 320
const H = 110
const PAD_X = 8
const PAD_Y = 12
const INNER_W = W - PAD_X * 2
const INNER_H = H - PAD_Y * 2
const KG_PER_LB = 0.453592

const E1RM_COLOR = "rgb(var(--accent))"
const VOLUME_COLOR = "rgb(56 189 248)" // same second-series blue as PoseTrendChart

interface ProgressionChartProps {
  /** Chronological per-session points (see lib/progression.ts). */
  readonly points: readonly SessionPoint[]
  /** Display unit — values are stored kg and converted for labels only. */
  readonly unit: Unit
}

/**
 * Per-exercise progression (P26): estimated-1RM trend line over per-session
 * volume bars, pure SVG in the PoseTrendChart style (no chart library). Each
 * series is normalized to its own range, so the shape of the trend is what
 * reads — the labels carry the numbers.
 */
function ProgressionChartInner({ points, unit }: ProgressionChartProps): JSX.Element | null {
  if (points.length === 0) return null

  const fromKg = (v: number): number => (unit === "lb" ? v / KG_PER_LB : v)
  const fmt = (v: number): string => `${Math.round(fromKg(v))} ${unit}`

  const x = (i: number): number =>
    points.length > 1 ? PAD_X + (i / (points.length - 1)) * INNER_W : W / 2

  // Normalize e1RM into its own [min, max] band (flat history still centers).
  const e1rms = points.map((p) => p.bestE1rm)
  const eMin = Math.min(...e1rms)
  const eMax = Math.max(...e1rms)
  const yE = (v: number): number =>
    eMax > eMin ? PAD_Y + (1 - (v - eMin) / (eMax - eMin)) * INNER_H : H / 2

  // Volume bars scale from the baseline to each session's share of the max.
  const vMax = Math.max(...points.map((p) => p.volumeKg))
  const barW = Math.min(14, INNER_W / Math.max(points.length, 1) / 2)
  const barH = (v: number): number => (vMax > 0 ? (v / vMax) * INNER_H : 0)

  const last = points[points.length - 1]
  const best = Math.max(...e1rms)
  const line = points.map((p, i) => `${x(i).toFixed(1)},${yE(p.bestE1rm).toFixed(1)}`).join(" ")

  return (
    <div className="flex flex-col gap-1" data-testid="progression-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-24 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Estimated one-rep max and volume across ${points.length} sessions; best ${fmt(best)}`}
      >
        <g data-testid="series-volume">
          {points.map((p, i) => (
            <rect
              key={p.workoutId}
              x={x(i) - barW / 2}
              y={H - PAD_Y - barH(p.volumeKg)}
              width={barW}
              height={barH(p.volumeKg)}
              rx={2}
              fill={VOLUME_COLOR}
              opacity={0.25}
            />
          ))}
        </g>
        <g data-testid="series-e1rm">
          {points.length > 1 && (
            <polyline
              points={line}
              fill="none"
              stroke={E1RM_COLOR}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {points.map((p, i) => (
            <circle key={p.workoutId} cx={x(i)} cy={yE(p.bestE1rm)} r={3} fill={E1RM_COLOR} />
          ))}
        </g>
      </svg>
      <div className="flex items-center justify-between text-[11px] text-gray-500">
        <span>
          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
          e1RM <span className="hud-numerals text-gray-300" data-testid="e1rm-last">{fmt(last.bestE1rm)}</span>
        </span>
        <span>
          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-sky-400/60" aria-hidden="true" />
          volume <span className="hud-numerals text-gray-300" data-testid="volume-last">{fmt(last.volumeKg)}</span>
        </span>
      </div>
    </div>
  )
}

export const ProgressionChart = memo(ProgressionChartInner)
