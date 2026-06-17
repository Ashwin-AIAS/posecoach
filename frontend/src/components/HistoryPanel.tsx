import { memo, useCallback, useEffect, useState } from "react"
import { BarChart3, ChevronRight, X } from "lucide-react"

import { apiFetch, apiJson, assignSessionPrep, fetchPreps } from "../lib/api"
import type { PrepCycle } from "../types"
import { HistoryStats } from "./HistoryStats"
import { HistorySessionDetail } from "./HistorySessionDetail"
import { HistoryTrend } from "./HistoryTrend"
import { Icon } from "./ui/Icon"

interface SessionSummary {
  readonly id: string
  readonly exercise: string
  /** "exercise" or "posing" (P16) — absent on older servers → treat as exercise. */
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
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
}

function HistoryPanelInner({ onClose }: HistoryPanelProps): JSX.Element {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [preps, setPreps] = useState<PrepCycle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiJson<SessionSummary[]>("/api/v1/history/sessions")
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[80vh] w-full max-w-2xl animate-scale-in flex-col rounded-2xl bg-surface-raised p-6 text-white shadow-elev-3"
        data-testid="history-panel"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Workout history</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-sm text-gray-400 hover:bg-surface-overlay hover:text-white"
            aria-label="Close"
          >
            <Icon icon={X} size={18} />
          </button>
        </div>

        {loading && <p className="text-sm text-gray-400">Loading…</p>}
        {error && <p className="text-sm text-score-bad">{error}</p>}
        {!loading && !error && sessions.length === 0 && (
          <div className="grid place-content-center gap-2 py-12 text-center">
            <div className="mx-auto grid h-12 w-12 place-content-center rounded-full bg-surface-overlay">
              <Icon icon={BarChart3} size={22} className="text-gray-400" />
            </div>
            <p className="text-sm text-gray-400">No sessions yet.</p>
            <p className="text-xs text-gray-600">Sign in and train — your sets will appear here.</p>
          </div>
        )}

        {!loading && !error && sessions.length > 0 && (
          <>
            <HistoryStats sessions={sessions} />
            <div className="mb-4 border-b border-surface-hairline pb-4">
              <HistoryTrend sessions={sessions} />
            </div>
          </>
        )}

        <ul className="flex-1 divide-y divide-surface-hairline overflow-y-auto">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3" data-testid="history-row">
              <button
                type="button"
                onClick={() => setDetailId(s.id)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left transition hover:text-white"
                data-testid="history-row-open"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium capitalize">{s.exercise.replace(/_/g, " ")}</span>
                    {s.session_type === "posing" && (
                      <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
                        Posing
                      </span>
                    )}
                    <span className="text-xs text-gray-600">{formatDate(s.started_at)}</span>
                  </div>
                  <div className="text-xs text-gray-400">
                    {s.rep_count > 0 && <span>{s.rep_count} reps · </span>}
                    Avg score: {s.avg_form_score.toFixed(1)}
                  </div>
                </div>
                <Icon icon={ChevronRight} size={16} className="text-gray-600" />
              </button>
              {s.session_type === "posing" && preps.length > 0 && (
                <select
                  value={s.prep_id ?? ""}
                  onChange={(e) => void reassign(s.id, e.target.value || null)}
                  aria-label="Assign to prep"
                  data-testid="row-prep-select"
                  className="max-w-[8rem] rounded-md border border-surface-hairline bg-surface-overlay px-1.5 py-1 text-xs text-gray-300 focus:border-accent focus:outline-none"
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
                className="text-xs text-gray-500 transition hover:text-score-bad"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>

        {detailId && <HistorySessionDetail sessionId={detailId} onBack={() => setDetailId(null)} />}
      </div>
    </div>
  )
}

export const HistoryPanel = memo(HistoryPanelInner)
