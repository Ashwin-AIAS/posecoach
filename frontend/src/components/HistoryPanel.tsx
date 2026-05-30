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
      className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 text-white p-6 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        data-testid="history-panel"
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Workout history</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white text-sm"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {loading && <p className="text-sm text-gray-400">Loading…</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {!loading && !error && sessions.length === 0 && (
          <p className="text-sm text-gray-500">No sessions yet. Sign in and train to populate.</p>
        )}

        <ul className="flex-1 overflow-y-auto divide-y divide-gray-800">
          {sessions.map((s) => (
            <li key={s.id} className="py-3 flex items-center gap-4" data-testid="history-row">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium capitalize">{s.exercise}</span>
                  <span className="text-xs text-gray-500">{formatDate(s.started_at)}</span>
                </div>
                <div className="text-xs text-gray-400">
                  {s.rep_count > 0 && <span>{s.rep_count} reps · </span>}
                  Avg score: {s.avg_form_score.toFixed(1)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void remove(s.id)}
                className="text-xs text-red-400 hover:text-red-300"
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
