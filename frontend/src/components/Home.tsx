import { memo, useMemo } from "react"
import { Play } from "lucide-react"

import type { AuthUser } from "../hooks/useAuth"
import { useHistorySessions, type HistorySessionRow } from "../hooks/useHistorySessions"
import { exerciseLabel } from "../lib/exercises"
import type { Exercise } from "../types"
import { ScoreRing } from "./ScoreRing"
import { Icon } from "./ui/Icon"

interface HomeProps {
  readonly user: AuthUser | null
  /** The app's currently-selected exercise — the CTA resumes this, unchanged. */
  readonly lastExercise: Exercise
  readonly onStart: () => void
  readonly onShowHistory: () => void
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

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

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return "Good morning"
  if (h < 18) return "Good afternoon"
  return "Good evening"
}

function formatShortDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

/**
 * App entry hub: a greeting, today's snapshot rings, the primary "start a set"
 * CTA, and a recent-sessions strip. The live workout flow is unchanged — this
 * view only decides when it's shown (App owns the `view` state).
 */
function HomeInner({ user, lastExercise, onStart, onShowHistory }: HomeProps): JSX.Element {
  const { sessions, loading, authed } = useHistorySessions()

  const todayCount = useMemo(
    () => sessions.filter((s) => isSameDay(new Date(s.started_at), new Date())).length,
    [sessions],
  )
  const avgForm = useMemo(() => {
    if (sessions.length === 0) return null
    const recent = sessions.slice(0, 20)
    return recent.reduce((sum, s) => sum + s.avg_form_score, 0) / recent.length
  }, [sessions])
  const streak = useMemo(() => currentStreak(sessions), [sessions])
  const recent = sessions.slice(0, 6)

  return (
    <div
      className="flex-1 animate-fade-in overflow-y-auto p-4 sm:p-6"
      style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      data-testid="home-view"
    >
      <div className="mx-auto max-w-2xl">
        <h2 className="font-display text-xl font-semibold">
          {greeting()}
          {user ? `, ${user.email.split("@")[0]}` : ""}
        </h2>
        <p className="mt-0.5 text-sm text-gray-500">
          {authed ? "Here's your snapshot for today." : "Sign in to track your progress over time."}
        </p>

        {!loading && (
          <div className="mt-5 grid grid-cols-3 gap-3" data-testid="home-rings">
            <div className="flex flex-col items-center gap-1">
              <ScoreRing score={todayCount} size={84} label="Sessions" />
            </div>
            <div className="flex flex-col items-center gap-1">
              <ScoreRing score={avgForm !== null ? Math.round(avgForm) : null} size={84} label="Avg form" />
            </div>
            <div className="flex flex-col items-center gap-1">
              <ScoreRing score={streak} size={84} label="Streak" />
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onStart}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-4 text-base font-semibold text-surface-base shadow-elev-2 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] hover:brightness-110"
          data-testid="start-workout-btn"
        >
          <Icon icon={Play} size={18} />
          {sessions.length > 0 ? `Resume ${exerciseLabel(lastExercise)}` : `Start ${exerciseLabel(lastExercise)}`}
        </button>

        <div className="mt-8">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
              Recent sessions
            </h3>
            {recent.length > 0 && (
              <button
                type="button"
                onClick={onShowHistory}
                className="text-xs font-medium text-accent transition hover:underline active:opacity-60"
              >
                See all
              </button>
            )}
          </div>

          {recent.length === 0 ? (
            <p className="text-sm text-gray-500">
              {authed ? "Train a set to see it here." : "Sign in and train — your sets will appear here."}
            </p>
          ) : (
            <div className="-mx-1 flex gap-2 overflow-x-auto pb-1" data-testid="recent-strip">
              {recent.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={onShowHistory}
                  className="flex w-32 shrink-0 flex-col items-start gap-1 rounded-xl bg-surface-raised p-3 text-left shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97]"
                  data-testid="recent-strip-item"
                >
                  <span className="text-xs font-medium capitalize text-gray-200">
                    {s.exercise.replace(/_/g, " ")}
                  </span>
                  <span className="hud-numerals text-lg font-semibold text-accent">
                    {Math.round(s.avg_form_score)}
                  </span>
                  <span className="text-[11px] text-gray-600">{formatShortDate(s.started_at)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export const Home = memo(HomeInner)
