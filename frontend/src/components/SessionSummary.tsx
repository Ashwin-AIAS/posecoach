import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Award, Check, Play, Share2, Sparkles, Video, X } from "lucide-react"

import "../features/summary/summary.css"
import { computeReplayWindow } from "../features/summary/repReplay"
import type { RecordedSession } from "../hooks/useSessionRecorder"
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
import { shareResultCard } from "../lib/shareCard"
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
  /** Optional completed session recording for in-summary per-rep replay (P36 B4). */
  readonly recording?: RecordedSession | null
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

/**
 * One bar per counted rep, height proportional to that rep's form score, colored
 * by score. When `onSelectRep` is provided (recording available), each bar has a
 * tappable button overlay so tapping a rep replays that ~3s slice.
 */
function RepBars({
  values,
  activeRepIdx,
  onSelectRep,
}: {
  readonly values: readonly number[]
  readonly activeRepIdx: number | null
  readonly onSelectRep?: (index: number) => void
}): JSX.Element {
  const w = 260
  const h = 56
  const gap = 4
  const slot = w / values.length
  const barW = Math.max(3, slot - gap)

  return (
    <div className="relative">
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
          const selected = activeRepIdx === i
          return (
            <rect
              key={i}
              x={(i * slot).toFixed(1)}
              y={(h - barH).toFixed(1)}
              width={barW.toFixed(1)}
              height={barH.toFixed(1)}
              rx={3}
              fill={scoreColor(v)}
              opacity={activeRepIdx === null || selected ? 1 : 0.45}
            />
          )
        })}
      </svg>
      {onSelectRep !== undefined && (
        <div className="absolute inset-0 flex">
          {values.map((v, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSelectRep(i)}
              aria-label={`Replay rep ${i + 1} (score ${Math.round(v)})`}
              aria-pressed={activeRepIdx === i}
              className="min-h-14 flex-1 rounded transition active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              data-testid={`rep-replay-btn-${i}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * End-of-set payoff sheet (P36 Lane B — B1..B4):
 * - Full-height mobile sheet (elevated modal sheet on desktop)
 * - Hero rep count with count-up animation + one-line verdict
 * - Deterministic set insights (fatigue, history delta, consistency, joint cue)
 * - Scoped current-set Best + per-exercise Personal best
 * - Celebration pulse when avg >= 80 or new personal best
 * - On-device 1080x1920 shareable PNG card
 * - Per-rep video replay when `recording` is present; discovery hint when absent
 */
export function SessionSummary({
  exercise,
  stats,
  onClose,
  worstJoint,
  recording = null,
}: SessionSummaryProps): JSX.Element {
  const [historySessions, setHistorySessions] = useState<HistorySession[] | null>(null)
  const [trend, setTrend] = useState<number[] | null>(null)
  const [personalBest, setPersonalBest] = useState<number | null>(null)
  const [authed, setAuthed] = useState(true)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [rated, setRated] = useState<EffortRating | null>(null)
  const [sharing, setSharing] = useState(false)
  const [shareStatus, setShareStatus] = useState<"idle" | "shared" | "downloaded">("idle")

  const videoRef = useRef<HTMLVideoElement>(null)
  const replayEndSecRef = useRef<number | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [activeRepIdx, setActiveRepIdx] = useState<number | null>(null)

  const reduced = prefersReducedMotion()
  const displayedReps = useRepCountUp(stats.reps, reduced)

  useEffect(() => {
    if (!recording) {
      setVideoUrl(null)
      setActiveRepIdx(null)
      replayEndSecRef.current = null
      return
    }
    const url = URL.createObjectURL(recording.blob)
    setVideoUrl(url)
    return () => {
      URL.revokeObjectURL(url)
      setVideoUrl(null)
    }
  }, [recording])

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

  const handleSelectRep = useCallback(
    (repIndex: number): void => {
      if (!recording) return
      const video = videoRef.current
      const win = computeReplayWindow(
        stats.repTimesMs,
        recording.startedAtMs,
        repIndex,
        video?.duration,
      )
      setActiveRepIdx(repIndex)
      if (win === null || video === null) return
      replayEndSecRef.current = win.endSec
      video.currentTime = win.startSec
      const playPromise = video.play()
      if (playPromise !== undefined) {
        void playPromise.catch(() => {
          // Ignore autoplay/jsdom interruption errors
        })
      }
    },
    [recording, stats.repTimesMs],
  )

  const handleTimeUpdate = useCallback((): void => {
    const video = videoRef.current
    const endSec = replayEndSecRef.current
    if (video !== null && endSec !== null && video.currentTime >= endSec) {
      video.pause()
      replayEndSecRef.current = null
    }
  }, [])

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
  const canReplay = recording !== null && stats.repScores.length > 0

  const handleShareCard = async (): Promise<void> => {
    if (sharing) return
    setSharing(true)
    try {
      const result = await shareResultCard({
        exerciseId: exercise,
        exerciseLabel: label,
        reps: stats.reps,
        avgScore: stats.avgScore,
        bestScore: stats.bestScore,
        samples: stats.samples,
        repScores: stats.repScores,
        verdict,
      })
      if (result === "shared" || result === "downloaded") {
        setShareStatus(result)
      }
    } catch {
      // Canvas/share unavailable — fail gracefully.
    } finally {
      setSharing(false)
    }
  }

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

          {/* Per-rep bars (with inline replay when recorded) or hold timeline */}
          {stats.repScores.length > 0 ? (
            <div className="rounded-2xl bg-surface-overlay p-4 shadow-elev-1">
              <div className="mb-2.5 flex items-center justify-between">
                <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
                  Per-rep scores
                </h3>
                {canReplay && (
                  <span className="inline-flex items-center gap-1 text-xs text-accent">
                    <Icon icon={Play} size={12} />
                    {activeRepIdx !== null
                      ? `Rep ${activeRepIdx + 1} · ${Math.round(stats.repScores[activeRepIdx])}`
                      : "Tap a bar to replay"}
                  </span>
                )}
              </div>
              <RepBars
                values={stats.repScores}
                activeRepIdx={activeRepIdx}
                onSelectRep={canReplay ? handleSelectRep : undefined}
              />
              {canReplay && videoUrl !== null && (
                <div className="mt-3 overflow-hidden rounded-xl bg-black">
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    controls
                    muted
                    playsInline
                    onTimeUpdate={handleTimeUpdate}
                    className="max-h-64 w-full object-contain"
                    data-testid="rep-replay-video"
                  >
                    <track kind="captions" />
                  </video>
                </div>
              )}
            </div>
          ) : stats.holdSeries.length > 1 ? (
            <div className="rounded-2xl bg-surface-overlay p-4 shadow-elev-1">
              <h3 className="mb-2.5 text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
                Hold timeline
              </h3>
              <Sparkline values={stats.holdSeries} label="Hold form-score timeline" />
            </div>
          ) : null}

          {/* Replay discovery hint when no recording was captured */}
          {recording === null && (
            <div
              className="flex items-center gap-2.5 rounded-2xl bg-surface-overlay px-4 py-3 text-xs text-gray-400 shadow-elev-1"
              data-testid="rep-replay-hint"
            >
              <Icon icon={Video} size={15} className="shrink-0 text-gray-400" />
              <span>Tap Record before a set to replay reps</span>
            </div>
          )}

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

        {/* Sticky footer actions (§0.4 Secondary Share + Primary CTA) */}
        <div className="flex shrink-0 items-center gap-2.5 px-5 pt-2">
          <button
            type="button"
            onClick={() => void handleShareCard()}
            disabled={sharing}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-surface-overlay px-5 text-sm font-medium text-gray-200 shadow-elev-1 transition ease-spring hover:text-white active:scale-[0.97] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            data-testid="share-card-btn"
          >
            <Icon icon={Share2} size={16} />
            <span>
              {sharing
                ? "Preparing…"
                : shareStatus === "downloaded"
                  ? "Saved"
                  : shareStatus === "shared"
                    ? "Shared"
                    : "Share"}
            </span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-12 flex-1 items-center justify-center rounded-full bg-accent px-6 font-semibold text-surface-base shadow-elev-1 transition ease-spring hover:brightness-110 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          >
            Train again
          </button>
        </div>
      </div>
    </div>
  )
}
