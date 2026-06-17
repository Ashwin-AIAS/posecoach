import { useEffect, useState } from "react"
import { Check, X } from "lucide-react"

import type { SessionStats } from "../hooks/useSessionStats"
import type { EffortRating, Exercise } from "../types"
import { apiJson, submitEffort } from "../lib/api"
import { exerciseLabel } from "../lib/exercises"
import { scoreColor } from "../lib/skeleton"
import { Icon } from "./ui/Icon"

interface HistorySession {
  readonly id: string
  readonly exercise?: string
  readonly avg_form_score: number
  readonly started_at: string
}

const EFFORT_OPTIONS: readonly { value: EffortRating; label: string }[] = [
  { value: 1, label: "Too easy" },
  { value: 3, label: "Just right" },
  { value: 5, label: "Too hard" },
]

interface SessionSummaryProps {
  readonly exercise: Exercise
  readonly stats: SessionStats
  readonly onClose: () => void
}

function Sparkline({
  values,
  label = "Average score trend",
}: {
  values: readonly number[]
  label?: string
}): JSX.Element {
  const w = 220
  const h = 48
  const max = Math.max(...values, 100)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const step = values.length > 1 ? w / (values.length - 1) : 0
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`)
    .join(" ")
  const lastX = (values.length - 1) * step
  const lastY = h - ((values[values.length - 1] - min) / span) * h
  return (
    <svg width={w} height={h} className="w-full" role="img" aria-label={label}>
      <polyline
        points={points}
        fill="none"
        stroke="rgb(var(--accent))"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r={3} fill="rgb(var(--accent))" />
    </svg>
  )
}

/** One bar per counted rep, height ∝ that rep's form score, colored by score. */
function RepBars({ values }: { values: readonly number[] }): JSX.Element {
  const w = 220
  const h = 48
  const gap = 3
  const slot = w / values.length
  const barW = Math.max(2, slot - gap)
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-12 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Per-rep form scores"
    >
      {values.map((v, i) => {
        const clamped = Math.max(0, Math.min(100, v))
        const barH = Math.max(1, (clamped / 100) * h)
        return (
          <rect
            key={i}
            x={(i * slot).toFixed(1)}
            y={(h - barH).toFixed(1)}
            width={barW.toFixed(1)}
            height={barH.toFixed(1)}
            rx={1}
            fill={scoreColor(v)}
          />
        )
      })}
    </svg>
  )
}

function StatTile({ label, value, color }: { label: string; value: string; color?: string }): JSX.Element {
  return (
    <div className="rounded-xl bg-surface-overlay p-3 text-center shadow-elev-1">
      <div className="hud-numerals font-display text-2xl font-semibold" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
    </div>
  )
}

/**
 * End-of-set summary: this session's reps / avg / best, plus a trend sparkline
 * of recent sessions' average scores pulled from the user's workout history.
 */
export function SessionSummary({ exercise, stats, onClose }: SessionSummaryProps): JSX.Element {
  const [trend, setTrend] = useState<number[] | null>(null)
  const [authed, setAuthed] = useState(true)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [rated, setRated] = useState<EffortRating | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const sessions = await apiJson<HistorySession[]>("/api/v1/history/sessions")
        if (cancelled) return
        // Listing is newest-first — the first row for this exercise is the set
        // that just finished, which is the one the effort rating belongs to.
        const latest = sessions.find((s) => s.exercise === exercise)
        setSessionId(latest?.id ?? null)
        const series = [...sessions]
          .sort((a, b) => a.started_at.localeCompare(b.started_at))
          .map((s) => s.avg_form_score)
          .filter((v) => v > 0)
          .slice(-12)
        setTrend(series)
      } catch {
        if (!cancelled) setAuthed(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [exercise])

  const tapEffort = (value: EffortRating): void => {
    if (rated !== null || sessionId === null) return
    setRated(value)
    void submitEffort(sessionId, value).catch(() => {
      // Non-blocking — the rating is best-effort; the summary stays usable.
    })
  }

  const best = trend && trend.length > 0 ? Math.max(...trend, stats.bestScore) : stats.bestScore

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Session summary"
      data-testid="session-summary"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md animate-scale-in rounded-2xl bg-surface-raised p-6 text-white shadow-elev-3"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold">Set complete</h2>
            <p className="text-xs text-gray-500">{exerciseLabel(exercise)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-sm text-gray-400 hover:bg-surface-overlay hover:text-white"
            aria-label="Close"
          >
            <Icon icon={X} size={18} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <StatTile label="Reps" value={String(stats.reps)} />
          <StatTile
            label="Avg score"
            value={stats.samples > 0 ? String(Math.round(stats.avgScore)) : "—"}
            color={stats.samples > 0 ? scoreColor(stats.avgScore) : undefined}
          />
          <StatTile
            label="Best"
            value={best > 0 ? String(Math.round(best)) : "—"}
            color={best > 0 ? scoreColor(best) : undefined}
          />
        </div>

        {authed && sessionId !== null && (
          <div className="mt-5" data-testid="effort-question">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
              How hard was that?
            </h3>
            <div className="flex gap-2">
              {EFFORT_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => tapEffort(value)}
                  disabled={rated !== null}
                  aria-pressed={rated === value}
                  className={
                    "flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition ease-spring hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50 " +
                    (rated === value
                      ? "border border-accent bg-accent-soft text-accent disabled:opacity-100"
                      : "bg-surface-overlay text-gray-300 shadow-elev-1 hover:text-white")
                  }
                >
                  {rated === value ? (
                    <span className="inline-flex items-center gap-1">
                      <Icon icon={Check} size={14} />
                      {label}
                    </span>
                  ) : (
                    label
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {stats.repScores.length > 0 ? (
          <div className="mt-5">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
              Per-rep scores
            </h3>
            <RepBars values={stats.repScores} />
          </div>
        ) : stats.holdSeries.length > 1 ? (
          <div className="mt-5">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
              Hold timeline
            </h3>
            <Sparkline values={stats.holdSeries} label="Hold form-score timeline" />
          </div>
        ) : null}

        <div className="mt-5">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-gray-500">Recent trend</h3>
          {!authed ? (
            <p className="text-sm text-gray-500">Sign in to track your progress over time.</p>
          ) : trend === null ? (
            <p className="text-sm text-gray-600">Loading…</p>
          ) : trend.length < 2 ? (
            <p className="text-sm text-gray-500">Train a few sessions to see your trend.</p>
          ) : (
            <Sparkline values={trend} />
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full rounded-lg bg-accent py-2 font-medium text-surface-base transition hover:brightness-110"
        >
          Train again
        </button>
      </div>
    </div>
  )
}
