import { useMemo, useState } from "react"

import type { Exercise } from "../types"
import { EXERCISES } from "../types"
import { exerciseLabel } from "../lib/exercises"

/** Minimal shape needed to plot a trend — a subset of the history session row. */
export interface TrendSession {
  readonly exercise: string
  readonly avg_form_score: number
  readonly started_at: string
}

const W = 320
const H = 120
const PAD_X = 8
const PAD_Y = 10
const INNER_W = W - PAD_X * 2
const INNER_H = H - PAD_Y * 2

function isExercise(value: string): value is Exercise {
  return (EXERCISES as readonly string[]).includes(value)
}

/** Human label for a backend exercise id, falling back to a de-underscored name. */
function labelFor(ex: string): string {
  return isExercise(ex) ? exerciseLabel(ex) : ex.replace(/_/g, " ")
}

/**
 * Progress-over-time chart: average form score across sessions for one exercise,
 * plotted as a pure-SVG area + line (no chart library — keeps the bundle lean).
 * Filterable by exercise; the Y axis is fixed 0–100 so a single point never
 * produces a broken axis.
 */
export function HistoryTrend({ sessions }: { sessions: readonly TrendSession[] }): JSX.Element {
  // Distinct exercises present in the history, in first-seen order.
  const present = useMemo(() => {
    const seen: string[] = []
    for (const s of sessions) if (!seen.includes(s.exercise)) seen.push(s.exercise)
    return seen
  }, [sessions])

  const [selected, setSelected] = useState<string>("")
  const active = present.includes(selected) ? selected : (present[0] ?? "")

  const values = useMemo(
    () =>
      sessions
        .filter((s) => s.exercise === active)
        .slice()
        .sort((a, b) => a.started_at.localeCompare(b.started_at))
        .map((s) => s.avg_form_score),
    [sessions, active],
  )

  if (sessions.length === 0) {
    return <p className="text-sm text-gray-500">Train a few sessions to see your progress.</p>
  }

  const x = (i: number): number =>
    values.length > 1 ? PAD_X + (i / (values.length - 1)) * INNER_W : W / 2
  const y = (v: number): number => PAD_Y + (1 - Math.max(0, Math.min(100, v)) / 100) * INNER_H
  const baseline = PAD_Y + INNER_H

  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
  const area =
    values.length > 1
      ? `M${x(0).toFixed(1)},${baseline.toFixed(1)} L${line.replace(/ /g, " L")} L${x(values.length - 1).toFixed(1)},${baseline.toFixed(1)} Z`
      : ""

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">Progress</h3>
        <select
          value={active}
          onChange={(e) => setSelected(e.target.value)}
          aria-label="Filter by exercise"
          className="rounded-md border border-surface-hairline bg-surface-overlay px-2 py-1 text-xs text-gray-200 focus:border-accent focus:outline-none"
        >
          {present.map((ex) => (
            <option key={ex} value={ex}>
              {labelFor(ex)}
            </option>
          ))}
        </select>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-28 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Average form score over time for ${labelFor(active)}`}
      >
        {area !== "" && <path d={area} fill="rgb(var(--accent) / 0.15)" />}
        {values.length > 1 && (
          <polyline
            points={line}
            fill="none"
            stroke="rgb(var(--accent))"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {values.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r={3} fill="rgb(var(--accent))" data-testid="trend-point" />
        ))}
      </svg>
    </div>
  )
}
