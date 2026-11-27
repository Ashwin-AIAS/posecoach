import type { HistorySessionRow } from "../hooks/useHistorySessions"
import { EXERCISE_META } from "./exercises"
import type { Exercise } from "../types"

export type InsightKind = "trend" | "neglected" | "consistency"

export interface HomeInsight {
  readonly id: string
  readonly kind: InsightKind
  readonly title: string
  readonly detail: string
  /** Pre-filled question sent to Coach AI when the user taps "Ask Coach". */
  readonly prompt: string
  readonly exercise?: string
}

const DAY_MS = 86_400_000
const NEGLECT_THRESHOLD_DAYS = 7
const TREND_WINDOW_DAYS = 14
const MIN_TREND_DELTA = 3
const MAX_INSIGHTS = 2

/** Human-readable exercise name, falling back to title-cased slug for unknown keys. */
export function formatExerciseName(key: string): string {
  const meta = (EXERCISE_META as Record<string, { label: string } | undefined>)[key]
  if (meta) return meta.label
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Start of the ISO week (Monday 00:00:00 local time) for a given date. */
export function startOfIsoWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = d.getDay() // 0 = Sun, 1 = Mon, ...
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

/** Returns the most recent exercise key from session history, or null if empty. */
export function getLastExercise(sessions: readonly HistorySessionRow[]): string | null {
  if (sessions.length === 0) return null
  let latest = sessions[0]
  let latestMs = new Date(latest.started_at).getTime()
  for (let i = 1; i < sessions.length; i++) {
    const ms = new Date(sessions[i].started_at).getTime()
    if (ms > latestMs) {
      latest = sessions[i]
      latestMs = ms
    }
  }
  return latest.exercise
}

interface ExerciseTrend {
  readonly exercise: string
  readonly delta: number
  readonly recentAvg: number
  readonly previousAvg: number
}

function computeExerciseTrends(
  sessions: readonly HistorySessionRow[],
  nowMs: number,
): ExerciseTrend[] {
  const byExercise = new Map<string, HistorySessionRow[]>()
  for (const s of sessions) {
    const list = byExercise.get(s.exercise)
    if (list) list.push(s)
    else byExercise.set(s.exercise, [s])
  }

  const cutoffRecent = nowMs - TREND_WINDOW_DAYS * DAY_MS
  const cutoffPrev = nowMs - TREND_WINDOW_DAYS * 2 * DAY_MS
  const trends: ExerciseTrend[] = []

  for (const [exercise, rows] of byExercise.entries()) {
    if (rows.length < 2) continue
    const sorted = [...rows].sort(
      (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
    )

    const recentRows = sorted.filter((r) => new Date(r.started_at).getTime() >= cutoffRecent)
    const prevRows = sorted.filter((r) => {
      const t = new Date(r.started_at).getTime()
      return t < cutoffRecent && t >= cutoffPrev
    })

    let recentGroup = recentRows
    let prevGroup = prevRows

    // Fall back to splitting the exercise's sessions in half when all fall inside 14d.
    if (recentGroup.length === 0 || prevGroup.length === 0) {
      const mid = Math.ceil(sorted.length / 2)
      recentGroup = sorted.slice(0, mid)
      prevGroup = sorted.slice(mid)
    }

    if (recentGroup.length === 0 || prevGroup.length === 0) continue

    const recentAvg =
      recentGroup.reduce((sum, r) => sum + r.avg_form_score, 0) / recentGroup.length
    const previousAvg =
      prevGroup.reduce((sum, r) => sum + r.avg_form_score, 0) / prevGroup.length
    const delta = Math.round(recentAvg - previousAvg)

    trends.push({
      exercise,
      delta,
      recentAvg: Math.round(recentAvg),
      previousAvg: Math.round(previousAvg),
    })
  }

  return trends
}

/**
 * Returns the exercise with the worst downward form trend (or lowest average
 * score if no exercise is trending down). Used by Coach AI for smart chips.
 */
export function getWorstTrendingExercise(
  sessions: readonly HistorySessionRow[],
  now: Date = new Date(),
): string | null {
  if (sessions.length === 0) return null
  const trends = computeExerciseTrends(sessions, now.getTime())
  const declining = trends
    .filter((t) => t.delta < 0)
    .sort((a, b) => a.delta - b.delta)
  if (declining.length > 0) return declining[0].exercise

  // Otherwise pick the exercise with the lowest average form score.
  const totals = new Map<string, { sum: number; count: number }>()
  for (const s of sessions) {
    const prev = totals.get(s.exercise) ?? { sum: 0, count: 0 }
    totals.set(s.exercise, { sum: prev.sum + s.avg_form_score, count: prev.count + 1 })
  }
  let worstEx: string | null = null
  let worstAvg = Infinity
  for (const [ex, { sum, count }] of totals.entries()) {
    const avg = sum / count
    if (avg < worstAvg) {
      worstAvg = avg
      worstEx = ex
    }
  }
  return worstEx
}

/**
 * Deterministic, pure home insights derived strictly from session history.
 * Returns at most 2 concise cards covering trend, neglected movement, and
 * weekly consistency.
 */
export function computeHomeInsights(
  sessions: readonly HistorySessionRow[],
  now: Date = new Date(),
): readonly HomeInsight[] {
  if (sessions.length === 0) return []

  const nowMs = now.getTime()
  const candidates: HomeInsight[] = []

  // 1. Form trend per exercise (largest meaningful delta over 2 weeks).
  const trends = computeExerciseTrends(sessions, nowMs)
    .filter((t) => Math.abs(t.delta) >= MIN_TREND_DELTA)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  if (trends.length > 0) {
    const top = trends[0]
    const label = formatExerciseName(top.exercise)
    const sign = top.delta > 0 ? "+" : ""
    candidates.push({
      id: `trend-${top.exercise}`,
      kind: "trend",
      title: `${label} form ${sign}${top.delta} over 2 weeks`,
      detail: `Recent avg ${top.recentAvg} vs ${top.previousAvg} earlier`,
      prompt:
        top.delta > 0
          ? `My ${label.toLowerCase()} form improved by ${top.delta} points over the last two weeks. How do I keep progressing safely?`
          : `My ${label.toLowerCase()} form dropped by ${Math.abs(top.delta)} points recently. What cues should I focus on next set?`,
      exercise: top.exercise,
    })
  }

  // 2. Neglected movement (previously trained, not done in >= 7 days).
  const latestByEx = new Map<string, HistorySessionRow>()
  for (const s of sessions) {
    const prev = latestByEx.get(s.exercise)
    if (!prev || new Date(s.started_at).getTime() > new Date(prev.started_at).getTime()) {
      latestByEx.set(s.exercise, s)
    }
  }

  let mostNeglected: { exercise: string; days: number; lastScore: number } | null = null
  for (const [exercise, row] of latestByEx.entries()) {
    const days = Math.floor((nowMs - new Date(row.started_at).getTime()) / DAY_MS)
    if (days >= NEGLECT_THRESHOLD_DAYS) {
      if (!mostNeglected || days > mostNeglected.days) {
        mostNeglected = {
          exercise,
          days,
          lastScore: Math.round(row.avg_form_score),
        }
      }
    }
  }

  if (mostNeglected) {
    const label = formatExerciseName(mostNeglected.exercise)
    candidates.push({
      id: `neglected-${mostNeglected.exercise}`,
      kind: "neglected",
      title: `No ${label.toLowerCase()} in ${mostNeglected.days} days`,
      detail: `Last session averaged ${mostNeglected.lastScore} form`,
      prompt: `I haven't trained ${label.toLowerCase()} in ${mostNeglected.days} days. How should I warm up and ease back in?`,
      exercise: mostNeglected.exercise,
    })
  }

  // 3. Weekly consistency (this ISO week vs prior weeks).
  const thisWeekStart = startOfIsoWeek(now).getTime()
  const weekCounts = new Map<number, number>()
  for (const s of sessions) {
    const wk = startOfIsoWeek(new Date(s.started_at)).getTime()
    weekCounts.set(wk, (weekCounts.get(wk) ?? 0) + 1)
  }
  const thisWeekCount = weekCounts.get(thisWeekStart) ?? 0
  let bestPriorWeek = 0
  for (const [wk, count] of weekCounts.entries()) {
    if (wk < thisWeekStart && count > bestPriorWeek) {
      bestPriorWeek = count
    }
  }

  if (thisWeekCount >= 2) {
    const isBest = bestPriorWeek > 0 && thisWeekCount >= bestPriorWeek
    candidates.push({
      id: "consistency-week",
      kind: "consistency",
      title: isBest
        ? `${thisWeekCount} sessions this week — best yet`
        : `${thisWeekCount} sessions logged this week`,
      detail: isBest
        ? `Beats your previous best of ${bestPriorWeek} in a week`
        : "Consistent training builds cleaner movement patterns",
      prompt: `I've completed ${thisWeekCount} sessions this week. How should I balance intensity and recovery for my next workout?`,
    })
  }

  return candidates.slice(0, MAX_INSIGHTS)
}

/** Helper to check if an exercise key is a known Exercise union member. */
export function isKnownExercise(key: string): key is Exercise {
  return key in EXERCISE_META
}
