import { memo, useEffect, useMemo, useState } from "react"
import { Bot, ChevronRight, Play, Sparkles } from "lucide-react"

import type { AuthUser } from "../hooks/useAuth"
import { useHistorySessions, type HistorySessionRow } from "../hooks/useHistorySessions"
import { fetchRecommendation } from "../lib/api"
import { exerciseLabel } from "../lib/exercises"
import { computeHomeInsights, startOfIsoWeek } from "../lib/insights"
import { jointLabel, scoreColor } from "../lib/skeleton"
import type { Exercise, Recommendation } from "../types"
import { StatTile } from "../features/home/StatTile"
import { WeekStrip } from "../features/home/WeekStrip"
import { ScoreRing } from "./ScoreRing"
import { Icon } from "./ui/Icon"

interface HomeProps {
  readonly user: AuthUser | null
  /** The app's currently-selected exercise — the CTA resumes this, unchanged. */
  readonly lastExercise: Exercise
  readonly onStart: () => void
  readonly onShowHistory: () => void
  /**
   * Opens the Coach AI chat (P35). Text-only — no camera session is started.
   * Optional so the card only appears where a host wires it up.
   */
  readonly onOpenCoachAi?: () => void
  /**
   * Optional callback (P36 C3) to open Coach AI pre-filled with a specific
   * insight question. Falls back to `onOpenCoachAi` when not yet wired.
   */
  readonly onAskCoach?: (prompt: string) => void
}

const WEEKLY_SESSION_GOAL = 4
const STREAK_RING_GOAL = 7

/** Consecutive days, counting back from today, that each had at least one session. */
function currentStreak(sessions: readonly HistorySessionRow[]): number {
  const days = new Set(sessions.map((s) => new Date(s.started_at).toDateString()))
  let streak = 0
  const cursor = new Date()
  while (days.has(cursor.toDateString())) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

function formatShortDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function formQualityLabel(score: number): string {
  if (score >= 80) return "Good form"
  if (score >= 60) return "Fair form"
  return "Needs work"
}

function buildTodayHeadline(exercise: Exercise, rec: Recommendation | null): string {
  const name = exerciseLabel(exercise)
  if (rec === null) return `Start with ${name}`
  const parts: string[] = [name]
  if (rec.rep_target_delta !== 0) {
    const sign = rec.rep_target_delta > 0 ? "+" : ""
    const unit = rec.exercise === "plank" ? "s" : Math.abs(rec.rep_target_delta) === 1 ? " rep" : " reps"
    parts.push(`${sign}${rec.rep_target_delta}${unit}`)
  }
  if (rec.focus_joint) {
    parts.push(`focus: ${jointLabel(rec.focus_joint).toLowerCase()}`)
  }
  return parts.join(" · ")
}

/**
 * App entry hub (P36 C1–C3): Today hero card driven by the adaptive coach
 * recommendation, weekly activity strip + streak, accurate stat tiles (accent
 * rings for counts, ScoreRing only for Avg form), recent sessions coloured by
 * form quality, and deterministic insight cards with "Ask Coach" triggers.
 */
function HomeInner({
  user,
  lastExercise,
  onStart,
  onShowHistory,
  onOpenCoachAi,
  onAskCoach,
}: HomeProps): JSX.Element {
  const { sessions, loading, authed } = useHistorySessions()
  const [rec, setRec] = useState<Recommendation | null>(null)

  useEffect(() => {
    let cancelled = false
    setRec(null)
    if (typeof fetchRecommendation !== "function") return
    void fetchRecommendation(lastExercise).then((r) => {
      if (!cancelled) setRec(r)
    })
    return () => {
      cancelled = true
    }
  }, [lastExercise])

  const weeklyCount = useMemo(() => {
    const weekStart = startOfIsoWeek(new Date()).getTime()
    return sessions.filter((s) => new Date(s.started_at).getTime() >= weekStart).length
  }, [sessions])

  const avgForm = useMemo(() => {
    if (sessions.length === 0) return null
    const recentSlice = sessions.slice(0, 20)
    return recentSlice.reduce((sum, s) => sum + s.avg_form_score, 0) / recentSlice.length
  }, [sessions])

  const streak = useMemo(() => currentStreak(sessions), [sessions])
  const insights = useMemo(() => computeHomeInsights(sessions), [sessions])
  const recent = sessions.slice(0, 6)

  const todayHeadline = buildTodayHeadline(lastExercise, authed ? rec : null)
  const todaySubtitle = !authed
    ? "Sign in to track your progress over time."
    : rec !== null
      ? rec.message
      : "Real-time pose feedback and automatic rep counting for your next set."

  const handleInsightAsk = (prompt: string): void => {
    if (onAskCoach) {
      onAskCoach(prompt)
    } else if (onOpenCoachAi) {
      onOpenCoachAi()
    }
  }

  return (
    <div
      className="flex-1 animate-fade-in overflow-y-auto p-4 sm:p-6"
      style={{ paddingBottom: "calc(max(1rem, env(safe-area-inset-bottom)) + var(--tabbar-h, 52px))" }}
      data-testid="home-view"
    >
      <div className="mx-auto max-w-2xl">
        {/* Today hero card (C2) */}
        <section
          className="rounded-2xl bg-surface-raised p-5 shadow-elev-2"
          data-testid="today-hero-card"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
              Today{user ? ` · ${user.email.split("@")[0]}` : ""}
            </span>
            {authed && rec !== null && (
              <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-medium text-accent">
                Recommended
              </span>
            )}
          </div>

          <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-white">
            {todayHeadline}
          </h2>
          <p className="mt-1 text-sm text-gray-400">{todaySubtitle}</p>

          <button
            type="button"
            onClick={onStart}
            className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-accent px-6 text-base font-semibold text-surface-base shadow-elev-2 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
            data-testid="start-workout-btn"
          >
            <Icon icon={Play} size={18} />
            Start
          </button>
        </section>

        {/* Week strip + streak (C2) */}
        {!loading && <WeekStrip sessions={sessions} streak={streak} />}

        {/* Stat row (C1): StatTile for counts (accent), ScoreRing ONLY for Avg form */}
        {!loading && (
          <div
            className="mt-4 grid grid-cols-3 gap-3 rounded-2xl bg-surface-raised p-4 shadow-elev-1"
            data-testid="home-rings"
          >
            <div className="flex flex-col items-center gap-1">
              <StatTile
                value={weeklyCount}
                goal={WEEKLY_SESSION_GOAL}
                size={84}
                label="Week"
                ariaLabel={`${weeklyCount} of ${WEEKLY_SESSION_GOAL} sessions this week`}
                testId="stat-sessions"
              />
            </div>
            <div className="flex flex-col items-center gap-1">
              <ScoreRing
                score={avgForm !== null ? Math.round(avgForm) : null}
                size={84}
                label="Avg form"
              />
            </div>
            <div className="flex flex-col items-center gap-1">
              <StatTile
                value={streak}
                goal={STREAK_RING_GOAL}
                size={84}
                label="Streak"
                ariaLabel={`${streak}-day streak`}
                testId="stat-streak"
              />
            </div>
          </div>
        )}

        {/* Coach AI — one tap to ask a question, no camera session needed (P35). */}
        {onOpenCoachAi && (
          <button
            type="button"
            onClick={onOpenCoachAi}
            className="mt-4 flex min-h-12 w-full items-center gap-3 rounded-2xl bg-surface-raised p-3.5 text-left shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            data-testid="coach-ai-btn"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft">
              <Icon icon={Bot} size={19} className="text-accent" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-gray-100">Coach AI</span>
              <span className="block text-xs text-gray-500">
                Ask about form, sets, nutrition
              </span>
            </span>
            <Icon icon={ChevronRight} size={18} className="shrink-0 text-gray-500" />
          </button>
        )}

        {/* Recent sessions (C2): §0.4 cards with form-quality colour + label */}
        <section className="mt-6">
          <div className="mb-2.5 flex items-center justify-between">
            <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
              Recent sessions
            </h3>
            {recent.length > 0 && (
              <button
                type="button"
                onClick={onShowHistory}
                className="min-h-11 rounded-full px-2 text-xs font-medium text-accent transition hover:underline active:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                See all
              </button>
            )}
          </div>

          {recent.length === 0 ? (
            <div className="rounded-2xl bg-surface-raised p-4 shadow-elev-1">
              <p className="text-sm text-gray-400">
                {authed
                  ? "Train a set to see your form history here."
                  : "Sign in and train — your sets will appear here."}
              </p>
            </div>
          ) : (
            <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1" data-testid="recent-strip">
              {recent.map((s) => {
                const rounded = Math.round(s.avg_form_score)
                const color = scoreColor(rounded)
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={onShowHistory}
                    className="flex w-36 shrink-0 flex-col items-start gap-1 rounded-2xl bg-surface-raised p-3.5 text-left shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    data-testid="recent-strip-item"
                  >
                    <span className="text-xs font-medium capitalize text-gray-200">
                      {s.exercise.replace(/_/g, " ")}
                    </span>
                    <div className="flex items-baseline gap-1.5">
                      <span
                        className="hud-numerals font-display text-xl font-semibold"
                        style={{ color }}
                      >
                        {rounded}
                      </span>
                      <span className="text-[11px] font-medium" style={{ color }}>
                        {formQualityLabel(rounded)}
                      </span>
                    </div>
                    <span className="text-[11px] text-gray-500">
                      {formatShortDate(s.started_at)}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        {/* Deterministic insight cards (C3): max 2 cards below the fold */}
        {!loading && insights.length > 0 && (
          <section className="mt-6" data-testid="home-insights">
            <h3 className="mb-2.5 text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
              Insights
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {insights.map((insight) => (
                <div
                  key={insight.id}
                  className="flex flex-col justify-between gap-3 rounded-2xl bg-surface-raised p-4 shadow-elev-1"
                  data-testid="insight-card"
                >
                  <div>
                    <div className="flex items-center gap-1.5 text-accent">
                      <Icon icon={Sparkles} size={14} />
                      <span className="text-[11px] font-medium uppercase tracking-[0.14em]">
                        {insight.kind}
                      </span>
                    </div>
                    <p className="mt-1.5 font-display text-sm font-semibold text-white">
                      {insight.title}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">{insight.detail}</p>
                  </div>

                  {(onAskCoach || onOpenCoachAi) && (
                    <button
                      type="button"
                      onClick={() => handleInsightAsk(insight.prompt)}
                      className="flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-surface-overlay px-4 text-xs font-medium text-gray-200 shadow-elev-1 transition ease-spring hover:text-white active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      data-testid="insight-ask-coach"
                    >
                      <Icon icon={Bot} size={14} className="text-accent" />
                      Ask Coach
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

export const Home = memo(HomeInner)
