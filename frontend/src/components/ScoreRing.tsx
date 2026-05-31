import { memo } from "react"

import { scoreColor } from "../lib/skeleton"

interface ScoreRingProps {
  /** 0–100 form score, or null when no person/score is available. */
  readonly score: number | null
  /** Outer diameter in pixels. */
  readonly size?: number
  /** Optional caption under the number (e.g. "FORM"). */
  readonly label?: string
}

const STROKE = 8
const TRACK = "#23262D"

/**
 * Circular form-score gauge. The arc length is driven by `score` via
 * `stroke-dashoffset` with a CSS transition, and the stroke color follows the
 * red→amber→green ramp. Pure SVG + CSS — no animation runs on the frame path.
 */
function ScoreRingInner({ score, size = 132, label = "FORM" }: ScoreRingProps): JSX.Element {
  const radius = (size - STROKE) / 2
  const circumference = 2 * Math.PI * radius
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100
  const offset = circumference * (1 - pct)
  const color = scoreColor(score)

  return (
    <div
      className="relative grid place-items-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={score === null ? "Form score unavailable" : `Form score ${Math.round(score)} of 100`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={TRACK} strokeWidth={STROKE} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: "stroke-dashoffset 0.45s ease-out, stroke 0.45s ease-out",
            filter: `drop-shadow(0 0 6px ${color}66)`,
          }}
        />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <span
          className="hud-numerals font-display font-semibold leading-none"
          style={{ color, fontSize: size * 0.3 }}
          data-testid="ring-score-value"
        >
          {score === null ? "—" : Math.round(score)}
        </span>
        <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.2em] text-gray-500">{label}</span>
      </div>
    </div>
  )
}

export const ScoreRing = memo(ScoreRingInner)
