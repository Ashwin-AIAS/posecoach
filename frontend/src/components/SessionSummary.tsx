import { useEffect, useState } from "react"

import type { SessionStats } from "../hooks/useSessionStats"
import type { Exercise } from "../types"
import { apiJson } from "../lib/api"
import { exerciseLabel } from "../lib/exercises"
import { scoreColor } from "../lib/skeleton"

interface HistorySession {
  readonly id: string
  readonly avg_form_score: number
  readonly started_at: string
}

interface SessionSummaryProps {
  readonly exercise: Exercise
  readonly stats: SessionStats
  readonly onClose: () => void
}

function Sparkline({ values }: { values: readonly number[] }): JSX.Element {
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
    <svg width={w} height={h} className="w-full" role="img" aria-label="Average score trend">
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

function StatTile({ label, value, color }: { label: string; value: string; color?: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-surface-hairline bg-surface-overlay p-3 text-center">
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

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const sessions = await apiJson<HistorySession[]>("/api/v1/history/sessions")
        if (cancelled) return
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
  }, [])

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
        className="w-full max-w-md animate-scale-in rounded-2xl border border-surface-hairline bg-surface-raised p-6 text-white shadow-card"
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
            ✕
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
