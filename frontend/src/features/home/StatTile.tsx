import { memo } from "react"

interface StatTileProps {
  /** Numeric count to display (e.g. sessions this week, streak days). */
  readonly value: number
  /** Goal used to compute ring fill (clamped 0..100%). */
  readonly goal: number
  /** Short uppercase label below the number (e.g. "Sessions", "Streak"). */
  readonly label: string
  /** Accessible description, e.g. "8-day streak" or "2 of 4 sessions this week". */
  readonly ariaLabel: string
  /** Outer diameter in pixels (matches ScoreRing's 84px home size by default). */
  readonly size?: number
  /** Optional testid for targeted assertions. */
  readonly testId?: string
}

const STROKE = 10
const TRACK = "#23262D"

/**
 * Accent-coloured circular progress ring for non-form counts (sessions, streak).
 *
 * Counts deliberately use the brand accent colour (`--accent`), never the
 * red/amber/green form-score ramp (P36 §0.4 / C1), so a 1-session day or
 * 8-day streak never looks like a failing form score.
 */
function StatTileInner({
  value,
  goal,
  label,
  ariaLabel,
  size = 84,
  testId,
}: StatTileProps): JSX.Element {
  const safeGoal = Math.max(1, goal)
  const pct = Math.max(0, Math.min(1, value / safeGoal))
  const radius = (size - STROKE) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - pct)

  return (
    <div
      className="relative grid place-items-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={ariaLabel}
      data-testid={testId}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={TRACK}
          strokeWidth={STROKE}
        />
        {pct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgb(var(--accent))"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 0.35s ease-out" }}
          />
        )}
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <span
          className="hud-numerals font-display font-semibold leading-none text-white"
          style={{ fontSize: size * 0.3 }}
          data-testid={testId ? `${testId}-value` : undefined}
        >
          {value}
        </span>
        <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.16em] text-gray-500">
          {label}
        </span>
      </div>
    </div>
  )
}

export const StatTile = memo(StatTileInner)
