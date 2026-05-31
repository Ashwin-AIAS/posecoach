import { memo, useCallback, useEffect, useState } from "react"

import { apiFetch, apiJson } from "../lib/api"

interface SessionSummary {
  readonly id: string
  readonly exercise: string
  readonly rep_count: number
  readonly avg_form_score: number
  readonly started_at: string
  readonly ended_at: string | null
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
        className="flex max-h-[80vh] w-full max-w-2xl animate-scale-in flex-col rounded-2xl border border-surface-hairline bg-surface-raised p-6 text-white shadow-card"
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
            ✕
          </button>
        </div>

        {loading && <p className="text-sm text-gray-400">Loading…</p>}
        {error && <p className="text-sm text-score-bad">{error}</p>}
        {!loading && !error && sessions.length === 0 && (
          <div className="grid place-content-center gap-2 py-12 text-center">
            <div className="mx-auto grid h-12 w-12 place-content-center rounded-full bg-surface-overlay text-2xl">
              📊
            </div>
            <p className="text-sm text-gray-400">No sessions yet.</p>
            <p className="text-xs text-gray-600">Sign in and train — your sets will appear here.</p>
          </div>
        )}

        <ul className="flex-1 divide-y divide-surface-hairline overflow-y-auto">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-4 py-3" data-testid="history-row">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium capitalize">{s.exercise.replace(/_/g, " ")}</span>
                  <span className="text-xs text-gray-600">{formatDate(s.started_at)}</span>
                </div>
                <div className="text-xs text-gray-400">
                  {s.rep_count > 0 && <span>{s.rep_count} reps · </span>}
                  Avg score: {s.avg_form_score.toFixed(1)}
                </div>
              </div>
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
      </div>
    </div>
  )
}

export const HistoryPanel = memo(HistoryPanelInner)
