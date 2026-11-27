import { useEffect, useMemo, useState } from "react"
import { Award, Check, Sparkles, X } from "lucide-react"

import "../features/summary/summary.css"
import type { SessionStats } from "../hooks/useSessionStats"
import type { EffortRating, Exercise } from "../types"
import { apiJson, submitEffort } from "../lib/api"
import { exerciseLabel } from "../lib/exercises"
import {
  computeSetInsights,
  computeVerdict,
  isPersonalBestSet,
  priorSessionsFromHistory,
} from "../lib/setInsights"
import { scoreColor } from "../lib/skeleton"
import { Icon } from "./ui/Icon"
import { Sparkline, StatTile } from "./ui/Sparkline"

interface HistorySession {
  readonly id: string
  readonly exercise?: string
  readonly avg_form_score: number
  readonly rep_count?: number
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
  /** Optional explicit worst-joint override; defaults to `stats.worstJoint`. */
  readonly worstJoint?: string | null
}

/** jsdom (tests) and old browsers lack matchMedia — snap immediately when reduced. */
function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== "function") return true
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

const COUNT_UP_MS = 420

function useRepCountUp(target: number, reduced: boolean): number {
  const [value, setValue] = useState(() => (reduced ? target : 0))

  useEffect(() => {
    if (reduced || target <= 0) {
      setValue(target)
      return
    }
    setValue(0)
    const start = performance.now()
    let raf = 0
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(target * eased))
      if (t < 1) {
        raf = requestAnimationFrame(tick)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, reduced])

  return value
}

/** One bar per counted rep, height proportional to that rep's form score, colored by score. */
function RepBars({ values }: { values: readonly number[] }): JSX.Element {
  const w = 260
  const h = 56
  const gap = 4
  const slot = w / values.length
  const barW = Math.max(3, slot - gap)
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-14 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Per-rep form scores"
    >
      {values.map((v, i) => {
        const clamped = Math.max(0, Math.min(100, v))
        const barH = Math.max(2, (clamped / 100) * h)
        return (
          <rect
            key={i}
            x={(i * slot).toFixed(1)}
            y={(h - barH).toFixed(1)}
            width={barW.toFixed(1)}
            height={barH.toFixed(1)}
            rx={3}
            fill={scoreColor(v)}
          />
        )
      })}
    </svg>
  )
}

/**
 * End-of-set payoff sheet (P36 Lane B — B1 + B2):
 * - Full-height mobile sheet (elevated modal sheet on desktop)
 * - Hero rep count with count-up animation + one-line verdict
 * - Deterministic set insights (fatigue, history delta, consistency, joint cue)
 * - Scoped current-set Best + per-exercise Personal best
 * - Celebration pulse when avg >= 80 or new personal best
 */
export function SessionSummary({
  exercise,
  stats,
  onClose,
  worstJoint,
}: SessionSummaryProps): JSX.Element {
  const [historySessions, setHistorySessions] = useState<HistorySession[] | null>(null)
  const [trend, setTrend] = useState<number[] | null>(null)
  const [personalBest, setPersonalBest] = useState<number | null>(null)
  const [authed, setAuthed] = useState(true)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [rated, setRated] = useState<EffortRating | null>(null)

  const reduced = prefersReducedMotion()
  const displayedReps = useRepCountUp(stats.reps, reduced)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const sessions = await apiJson<HistorySession[]>("/api/v1/history/sessions")
        if (cancelled) return
        setHistorySessions(sessions)
        // Listing is newest-first — the first row for this exercise is the set
        // that just finished, which is the one the effort rating belongs to.
        const latest = sessions.find((s) => s.exercise === exercise)
        setSessionId(latest?.id ?? null)
        const exScores = sessions
          .filter((s) => s.exercise === exercise && s.avg_form_score > 0)
          .map((s) => s.avg_form_score)
        setPersonalBest(exScores.length > 0 ? Math.max(...exScores) : null)
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

  const label = exerciseLabel(exercise)
  const effectiveWorstJoint = worstJoint !== undefined ? worstJoint : (stats.worstJoint ?? null)

  const priorSessions = useMemo(
    () =>
      historySessions
        ? priorSessionsFromHistory(historySessions, exercise, stats.avgScore, stats.samples)
        : [],
    [historySessions, exercise, stats.avgScore, stats.samples],
  )

  const insightInput = useMemo(
    () => ({
      exerciseId: exercise,
      exerciseLabel: label,
      reps: stats.reps,
      avgScore: stats.avgScore,
      bestScore: stats.bestScore,
      samples: stats.samples,
      repScores: stats.repScores,
      worstJoint: effectiveWorstJoint,
      history: priorSessions,
    }),
    [exercise, label, stats, effectiveWorstJoint, priorSessions],
  )

  const verdict = useMemo(() => computeVerdict(insightInput), [insightInput])
  const insights = useMemo(() => computeSetInsights(insightInput), [insightInput])
  const isPb = useMemo(() => isPersonalBestSet(insightInput), [insightInput])

  const best = stats.bestScore
  const celebrate = (stats.samples > 0 && stats.avgScore >= 80) || isPb

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Session summary"
      data-testid="session-summary"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="summary-sheet-enter flex h-full w-full flex-col bg-surface-raised text-white shadow-elev-3 sm:h-auto sm:max-h-[90vh] sm:max-w-lg sm:rounded-2xl"
        style={{
          paddingTop: "max(1rem, env(safe-area-inset-top))",
          paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
        }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-5 pb-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
              Set complete
            </p>
            <h2 className="font-display text-lg font-semibold text-white">{label}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 shrink-0 place-content-center rounded-full bg-surface-overlay text-gray-300 shadow-elev-1 transition hover:text-white active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Close"
          >
            <Icon icon={X} size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-4">
          {/* Hero rep count + verdict + optional celebration pulse */}
          <div
            className={
              "rounded-2xl bg-surface-overlay p-5 text-center shadow-elev-2" +
              (celebrate ? " summary-celebrate" : "")
            }
            data-testid="summary-hero"
            data-celebrating={celebrate ? "true" : "false"}
          >
            {celebrate && (
              <div
                className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent"
                data-testid="summary-celebration"
              >
                <Icon icon={isPb ? Award : Sparkles} size={13} />
                <span>{isPb ? "Personal best" : "Dialed in"}</span>
              </div>
            )}
            <div className="hud-numerals font-display text-6xl font-semibold leading-none tracking-tight text-white">
              {displayedReps}
            </div>
            <div className="mt-1.5 text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
              Reps
            </div>
            <p className="mt-3 text-sm font-medium text-gray-200" data-testid="set-verdict">
              {verdict}
            </p>
          </div>

          {/* Form quality tiles (only form scores use the red/amber/green ramp) */}
          <div className="grid grid-cols-2 gap-2.5">
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

          {personalBest !== null && (
            <div
              className="flex items-center justify-between rounded-2xl bg-surface-overlay px-4 py-3 text-xs shadow-elev-1"
              data-testid="personal-best"
            >
              <span className="text-gray-400">Personal best ({label})</span>
              <span
                className="hud-numerals font-display text-sm font-semibold"
                style={{ color: scoreColor(personalBest) }}
              >
                {Math.round(personalBest)}
              </span>
            </div>
          )}

          {/* Deterministic set insights */}
          {insights.length > 0 && (
            <div data-testid="set-insights">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
                Set insights
              </h3>
              <ul className="space-y-2">
                {insights.map((line, idx) => (
                  <li
                    key={idx}
                    className="flex items-center gap-2.5 rounded-2xl bg-surface-overlay px-4 py-3 text-sm text-gray-200 shadow-elev-1"
                    data-testid="set-insight-item"
                  >
                    <span className="grid h-6 w-6 shrink-0 place-content-center rounded-full bg-accent-soft text-accent">
                      <Icon icon={Sparkles} size={13} />
                    </span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Effort rating (§0.4 secondary pills, >= 44px height, no hairline borders) */}
          {authed && sessionId !== null && (
            <div data-testid="effort-question">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
                How hard was that?
              </h3>
              <div className="flex gap-2">
                {EFFORT_OPTIONS.map(({ value, label: optLabel }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => tapEffort(value)}
                    disabled={rated !== null}
                    aria-pressed={rated === value}
                    className={
                      "flex min-h-11 flex-1 items-center justify-center rounded-full px-3 text-xs font-medium transition ease-spring active:scale-[0.97] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
                      (rated === value
                        ? "bg-accent-soft text-accent shadow-glow-sm disabled:opacity-100"
                        : "bg-surface-overlay text-gray-200 shadow-elev-1 hover:text-white")
                    }
                  >
                    {rated === value ? (
                      <span className="inline-flex items-center gap-1">
                        <Icon icon={Check} size={14} />
                        {optLabel}
                      </span>
                    ) : (
                      optLabel
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Per-rep bars or hold timeline */}
          {stats.repScores.length > 0 ? (
            <div className="rounded-2xl bg-surface-overlay p-4 shadow-elev-1">
              <h3 className="mb-2.5 text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
                Per-rep scores
              </h3>
              <RepBars values={stats.repScores} />
            </div>
          ) : stats.holdSeries.length > 1 ? (
            <div className="rounded-2xl bg-surface-overlay p-4 shadow-elev-1">
              <h3 className="mb-2.5 text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
                Hold timeline
              </h3>
              <Sparkline values={stats.holdSeries} label="Hold form-score timeline" />
            </div>
          ) : null}

          {/* Recent trend */}
          <div className="rounded-2xl bg-surface-overlay p-4 shadow-elev-1">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
              Recent trend
            </h3>
            {!authed ? (
              <p className="text-sm text-gray-400">Sign in to track your progress over time.</p>
            ) : trend === null ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : trend.length < 2 ? (
              <p className="text-sm text-gray-400">Train a few sessions to see your trend.</p>
            ) : (
              <Sparkline values={trend} />
            )}
          </div>
        </div>

        {/* Sticky footer CTA (§0.4 Primary CTA) */}
        <div className="shrink-0 px-5 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-12 w-full items-center justify-center rounded-full bg-accent px-6 font-semibold text-surface-base shadow-elev-1 transition ease-spring hover:brightness-110 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          >
            Train again
          </button>
        </div>
      </div>
    </div>
  )
}
