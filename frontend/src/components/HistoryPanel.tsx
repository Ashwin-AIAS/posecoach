import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { Award, BarChart3, ChevronRight, X } from "lucide-react"

import { apiFetch, apiJson, assignSessionPrep, fetchPreps } from "../lib/api"
import { exerciseLabel } from "../lib/exercises"
import { scoreColor } from "../lib/skeleton"
import type { Exercise, PrepCycle } from "../types"
import { EXERCISES } from "../types"
import { HistoryStats } from "./HistoryStats"
import { HistorySessionDetail } from "./HistorySessionDetail"
import { HistoryTrend } from "./HistoryTrend"
import { Icon } from "./ui/Icon"

interface SessionRow {
  readonly id: string
  readonly exercise: string
  /** "exercise" or "posing" (P16) — absent on older servers -> treat as exercise. */
  readonly session_type?: string
  readonly rep_count: number
  readonly avg_form_score: number
  readonly started_at: string
  readonly ended_at: string | null
  /** Contest-prep cycle this session is grouped under (P18), or null/absent. */
  readonly prep_id?: string | null
}

interface HistoryPanelProps {
  readonly onClose: () => void
  /** Optional CTA handler for launching a live set from the empty state (P36 B5). */
  readonly onStart?: () => void
}

function isExercise(value: string): value is Exercise {
  return (EXERCISES as readonly string[]).includes(value)
}

function displayExercise(raw: string): string {
  return isExercise(raw) ? exerciseLabel(raw) : raw.replace(/_/g, " ")
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
}

function HistoryPanelInner({ onClose, onStart }: HistoryPanelProps): JSX.Element {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [preps, setPreps] = useState<PrepCycle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiJson<SessionRow[]>("/api/v1/history/sessions")
      setSessions(data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Preps are best-effort: failure (e.g. signed out) just hides the tag control.
  useEffect(() => {
    void fetchPreps()
      .then(setPreps)
      .catch(() => setPreps([]))
  }, [])

  // Per-exercise personal bests (best avg_form_score per movement).
  const personalBests = useMemo(() => {
    const map = new Map<string, { score: number; bestSessionId: string }>()
    for (const s of sessions) {
      if (s.avg_form_score <= 0) continue
      const existing = map.get(s.exercise)
      if (!existing || s.avg_form_score > existing.score) {
        map.set(s.exercise, { score: s.avg_form_score, bestSessionId: s.id })
      }
    }
    return Array.from(map.entries())
      .map(([exercise, info]) => ({
        exercise,
        label: displayExercise(exercise),
        score: info.score,
        bestSessionId: info.bestSessionId,
      }))
      .sort((a, b) => b.score - a.score)
  }, [sessions])

  const pbSessionIds = useMemo(
    () => new Set(personalBests.map((pb) => pb.bestSessionId)),
    [personalBests],
  )

  const reassign = async (id: string, prepId: string | null): Promise<void> => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, prep_id: prepId } : s)))
    try {
      await assignSessionPrep(id, prepId)
    } catch {
      void load() // revert optimistic update on failure
    }
  }

  const remove = async (id: string): Promise<void> => {
    if (!confirm("Delete this session?")) return
    const resp = await apiFetch(`/api/v1/history/sessions/${id}`, { method: "DELETE" })
    if (resp.ok) setSessions((prev) => prev.filter((s) => s.id !== id))
  }

  const handleStart = (): void => {
    if (onStart) {
      onStart()
    } else {
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex h-full w-full animate-scale-in flex-col bg-surface-raised p-5 text-white shadow-elev-3 sm:h-auto sm:max-h-[85vh] sm:max-w-2xl sm:rounded-2xl sm:p-6"
        style={{
          paddingTop: "max(1.25rem, env(safe-area-inset-top))",
          paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
        }}
        data-testid="history-panel"
      >
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
              Progress
            </p>
            <h2 className="font-display text-lg font-semibold">Workout history</h2>
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

        {loading && <p className="text-sm text-gray-400">Loading…</p>}
        {error && <p className="text-sm text-score-bad">{error}</p>}

        {!loading && !error && sessions.length === 0 && (
          <div className="my-auto flex flex-col items-center gap-3 rounded-2xl bg-surface-overlay px-6 py-12 text-center shadow-elev-1">
            <div className="grid h-14 w-14 place-content-center rounded-full bg-accent-soft text-accent">
              <Icon icon={BarChart3} size={24} />
            </div>
            <p className="font-display text-base font-semibold text-white">No sessions yet.</p>
            <p className="max-w-xs text-sm text-gray-400">
              Complete a set to track your form scores and personal bests.
            </p>
            <button
              type="button"
              onClick={handleStart}
              className="mt-2 inline-flex min-h-12 items-center justify-center rounded-full bg-accent px-6 font-semibold text-surface-base shadow-elev-1 transition ease-spring hover:brightness-110 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
              data-testid="history-start-btn"
            >
              Start a set
            </button>
          </div>
        )}

        {!loading && !error && sessions.length > 0 && (
          <div className="flex-1 space-y-4 overflow-y-auto pr-0.5">
            <HistoryStats sessions={sessions} />

            {personalBests.length > 0 && (
              <div data-testid="history-personal-bests">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
                  Personal bests
                </h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {personalBests.map((pb) => (
                    <div
                      key={pb.exercise}
                      className="flex items-center justify-between rounded-2xl bg-surface-overlay px-3.5 py-2.5 shadow-elev-1"
                      data-testid={`pb-card-${pb.exercise}`}
                    >
                      <span className="truncate pr-2 text-xs font-medium capitalize text-gray-200">
                        {pb.label}
                      </span>
                      <span
                        className="hud-numerals font-display text-sm font-semibold"
                        style={{ color: scoreColor(pb.score) }}
                      >
                        {Math.round(pb.score)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <HistoryTrend sessions={sessions} />

            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
                Recent sessions
              </h3>
              <ul className="space-y-2.5">
                {sessions.map((s) => {
                  const isPb = pbSessionIds.has(s.id)
                  return (
                    <li
                      key={s.id}
                      className="flex items-center gap-2 rounded-2xl bg-surface-overlay px-3.5 py-3 shadow-elev-1"
                      data-testid="history-row"
                    >
                      <button
                        type="button"
                        onClick={() => setDetailId(s.id)}
                        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl text-left transition hover:text-white active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        data-testid="history-row-open"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium capitalize text-white">
                              {displayExercise(s.exercise)}
                            </span>
                            {s.session_type === "posing" && (
                              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                                Posing
                              </span>
                            )}
                            {isPb && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                                <Icon icon={Award} size={11} />
                                PB
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                            <span>{formatDate(s.started_at)}</span>
                            {s.rep_count > 0 && (
                              <span className="hud-numerals font-display text-gray-200">
                                · {s.rep_count} reps
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span
                            className="hud-numerals font-display text-base font-semibold"
                            style={{
                              color:
                                s.avg_form_score > 0 ? scoreColor(s.avg_form_score) : undefined,
                            }}
                          >
                            {s.avg_form_score > 0 ? Math.round(s.avg_form_score) : "—"}
                          </span>
                          <Icon icon={ChevronRight} size={16} className="text-gray-500" />
                        </div>
                      </button>
                      {s.session_type === "posing" && preps.length > 0 && (
                        <select
                          value={s.prep_id ?? ""}
                          onChange={(e) => void reassign(s.id, e.target.value || null)}
                          aria-label="Assign to prep"
                          data-testid="row-prep-select"
                          className="min-h-11 max-w-[8.5rem] rounded-full bg-surface-raised px-3 text-xs text-gray-200 shadow-elev-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <option value="">No prep</option>
                          {preps.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        onClick={() => void remove(s.id)}
                        className="min-h-11 shrink-0 rounded-full px-3 text-xs font-medium text-gray-400 transition hover:bg-surface-raised hover:text-score-bad active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        Delete
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        )}

        {detailId && <HistorySessionDetail sessionId={detailId} onBack={() => setDetailId(null)} />}
      </div>
    </div>
  )
}

export const HistoryPanel = memo(HistoryPanelInner)
