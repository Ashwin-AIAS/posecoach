import { useMemo } from "react"

import { Card } from "./ui/Card"
import { Sparkline, StatTile } from "./ui/Sparkline"

interface StatsSession {
  readonly avg_form_score: number
  readonly started_at: string
}

/** Longest run of consecutive calendar days that each had at least one session. */
function longestDayStreak(sessions: readonly StatsSession[]): number {
  const days = Array.from(new Set(sessions.map((s) => new Date(s.started_at).setHours(0, 0, 0, 0))))
    .sort((a, b) => a - b)
  if (days.length === 0) return 0
  const ONE_DAY_MS = 24 * 60 * 60 * 1000
  let best = 1
  let run = 1
  for (let i = 1; i < days.length; i++) {
    run = days[i] - days[i - 1] === ONE_DAY_MS ? run + 1 : 1
    best = Math.max(best, run)
  }
  return best
}

/**
 * Apple-style summary cards above the session list: total sessions, average
 * form score, and the longest day streak, each with a trend sparkline.
 */
export function HistoryStats({ sessions }: { readonly sessions: readonly StatsSession[] }): JSX.Element | null {
  const stats = useMemo(() => {
    if (sessions.length === 0) return null
    const ordered = [...sessions].sort((a, b) => a.started_at.localeCompare(b.started_at))
    const scores = ordered.map((s) => s.avg_form_score)
    const avg = scores.reduce((sum, v) => sum + v, 0) / scores.length
    return {
      count: sessions.length,
      avgScore: avg,
      streak: longestDayStreak(sessions),
      trend: scores.slice(-12),
    }
  }, [sessions])

  if (!stats) return null

  return (
    <div className="mb-4 grid grid-cols-3 gap-2" data-testid="history-stats">
      <Card elevation={1} className="p-3">
        <StatTile label="Sessions" value={String(stats.count)} />
      </Card>
      <Card elevation={1} className="p-3">
        <StatTile label="Avg form" value={Math.round(stats.avgScore).toString()} />
      </Card>
      <Card elevation={1} className="p-3">
        <StatTile label="Best streak" value={`${stats.streak}d`} />
      </Card>
      {stats.trend.length > 1 && (
        <div className="col-span-3 -mt-1">
          <Sparkline values={stats.trend} label="Recent average form score trend" />
        </div>
      )}
    </div>
  )
}
