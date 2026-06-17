import type { PosePoint } from "../types"

const W = 320
const H = 110
const PAD_X = 8
const PAD_Y = 10
const INNER_W = W - PAD_X * 2
const INNER_H = H - PAD_Y * 2

type Metric = "symmetry" | "steadiness"

interface Series {
  readonly key: Metric
  readonly label: string
  readonly color: string
}

// Symmetry and hold-steadiness share the 0–100 axis, so both ride one chart.
const SERIES: readonly Series[] = [
  { key: "symmetry", label: "Symmetry", color: "rgb(var(--accent))" },
  { key: "steadiness", label: "Steadiness", color: "rgb(56 189 248)" },
]

/**
 * Per-pose progress chart (P18): plots symmetry and hold-steadiness across a
 * prep's rehearsals as pure-SVG lines on a fixed 0–100 axis (no chart library).
 * A metric with no scored points (e.g. symmetry in profile poses) is omitted.
 */
export function PoseTrendChart({ points }: { points: readonly PosePoint[] }): JSX.Element {
  const x = (i: number): number =>
    points.length > 1 ? PAD_X + (i / (points.length - 1)) * INNER_W : W / 2
  const y = (v: number): number => PAD_Y + (1 - Math.max(0, Math.min(100, v)) / 100) * INNER_H

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-24 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Symmetry and steadiness over the prep"
      data-testid="pose-trend-chart"
    >
      {SERIES.map((s) => {
        // Keep each point's x by its rehearsal index; skip rehearsals the metric
        // wasn't scored in, so a profile pose simply has no symmetry line.
        const pts = points
          .map((p, i) => ({ i, v: p[s.key] }))
          .filter((p): p is { i: number; v: number } => p.v !== null)
        if (pts.length === 0) return null
        const line = pts.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")
        return (
          <g key={s.key} data-testid={`series-${s.key}`}>
            {pts.length > 1 && (
              <polyline
                points={line}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {pts.map((p) => (
              <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={3} fill={s.color} />
            ))}
          </g>
        )
      })}
    </svg>
  )
}

export { SERIES as POSE_TREND_SERIES }
