import { memo, useEffect, useState } from "react"
import { ChevronLeft } from "lucide-react"

import { getSessionDetail, type SessionDetail } from "../lib/api"
import { Sparkline, StatTile } from "./ui/Sparkline"
import { Icon } from "./ui/Icon"

interface HistorySessionDetailProps {
  readonly sessionId: string
  readonly onBack: () => void
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
}

/**
 * Tap-in detail for one past session: reuses the StatTile/Sparkline primitives
 * from the live SessionSummary, plotting the in-session score snapshots
 * (`keypoints_data.snapshots`) that the backend already persists.
 */
function HistorySessionDetailInner({ sessionId, onBack }: HistorySessionDetailProps): JSX.Element {
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setError(null)
    void getSessionDetail(sessionId)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  const snapshots = detail?.keypoints_data.snapshots ?? []
  const scores = snapshots.map((s) => s.score)

  return (
    <div
      className="absolute inset-0 z-10 flex animate-scale-in flex-col rounded-2xl bg-surface-raised p-6 text-white"
      data-testid="history-session-detail"
    >
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex items-center gap-1 self-start rounded text-xs font-medium text-gray-400 transition hover:text-white active:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Icon icon={ChevronLeft} size={14} />
        Back to history
      </button>

      {error && <p className="text-sm text-score-bad">{error}</p>}
      {!error && !detail && <p className="text-sm text-gray-400">Loading…</p>}

      {detail && (
        <>
          <h3 className="font-display text-lg font-semibold capitalize">
            {detail.exercise.replace(/_/g, " ")}
          </h3>
          <p className="text-xs text-gray-500">{formatDate(detail.started_at)}</p>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <StatTile label="Reps" value={String(detail.rep_count)} />
            <StatTile label="Avg score" value={Math.round(detail.avg_form_score).toString()} />
            <StatTile label="Snapshots" value={String(snapshots.length)} />
          </div>

          <div className="mt-5">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
              Score timeline
            </h4>
            {scores.length > 1 ? (
              <Sparkline values={scores} label="Form score over the course of this session" />
            ) : (
              <p className="text-sm text-gray-500">No timeline recorded for this session.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export const HistorySessionDetail = memo(HistorySessionDetailInner)
