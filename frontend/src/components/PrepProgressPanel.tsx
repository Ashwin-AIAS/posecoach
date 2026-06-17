import { memo, useCallback, useEffect, useState } from "react"
import { X } from "lucide-react"

import { createPrep, fetchPrepProgress, fetchPreps } from "../lib/api"
import type { PoseProgress, PrepCycle, PrepProgress } from "../types"
import { PoseTrendChart } from "./PoseTrendChart"
import { Icon } from "./ui/Icon"

interface PrepProgressPanelProps {
  readonly onClose: () => void
}

/** Weeks-out countdown copy: positive = before the show, negative = after. */
function countdown(weeksOut: number | null): string {
  if (weeksOut === null) return "No show date"
  if (weeksOut === 0) return "Show week"
  const n = Math.abs(weeksOut)
  const unit = n === 1 ? "week" : "weeks"
  return weeksOut > 0 ? `${n} ${unit} out` : `${n} ${unit} ago`
}

function metric(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${Math.round(value)}`
}

/** One pose's trend card: latest symmetry/steadiness, the chart, and what to fix next. */
const PoseCard = memo(function PoseCard({ pose }: { pose: PoseProgress }): JSX.Element {
  const latest = pose.points[pose.points.length - 1]
  return (
    <div className="rounded-xl bg-surface-overlay/60 p-3 shadow-elev-1" data-testid="prep-pose-card">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-white">{pose.label}</h3>
        <span className="text-[11px] text-gray-500">
          {pose.points.length} {pose.points.length === 1 ? "rehearsal" : "rehearsals"}
        </span>
      </div>

      <div className="mb-1 flex gap-4 text-[11px] text-gray-400">
        <span>
          <span className="text-accent">●</span> Symmetry{" "}
          <span className="hud-numerals text-gray-200">{metric(latest?.symmetry)}</span>
        </span>
        <span>
          <span className="text-sky-400">●</span> Steadiness{" "}
          <span className="hud-numerals text-gray-200">{metric(latest?.steadiness)}</span>
        </span>
      </div>

      <PoseTrendChart points={pose.points} />

      {pose.focus_cue && (
        <p className="mt-1 rounded-lg bg-score-mid/10 px-2.5 py-1.5 text-xs text-score-mid" data-testid="prep-focus-cue">
          Fix next: {pose.focus_cue}
        </p>
      )}
    </div>
  )
})

function PrepProgressPanelInner({ onClose }: PrepProgressPanelProps): JSX.Element {
  const [preps, setPreps] = useState<PrepCycle[]>([])
  const [activeId, setActiveId] = useState<string>("")
  const [progress, setProgress] = useState<PrepProgress | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState("")
  const [newDate, setNewDate] = useState("")

  const loadPreps = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const rows = await fetchPreps()
      setPreps(rows)
      setActiveId((prev) => (rows.some((p) => p.id === prev) ? prev : (rows[0]?.id ?? "")))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPreps()
  }, [loadPreps])

  // Fetch the selected prep's progress whenever the selection changes.
  useEffect(() => {
    if (!activeId) {
      setProgress(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const data = await fetchPrepProgress(activeId)
        if (!cancelled) setProgress(data)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeId])

  const submitNewPrep = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    try {
      const created = await createPrep(name, newDate || null)
      setNewName("")
      setNewDate("")
      setPreps((prev) => [created, ...prev])
      setActiveId(created.id)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const signedOut = error !== null && /\(401\)/.test(error)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-2xl animate-scale-in flex-col rounded-2xl bg-surface-raised p-6 text-white shadow-elev-3"
        data-testid="prep-progress-panel"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold">Contest prep</h2>
          <div className="flex items-center gap-2">
            {preps.length > 0 && (
              <select
                value={activeId}
                onChange={(e) => setActiveId(e.target.value)}
                aria-label="Select prep cycle"
                data-testid="prep-select"
                className="rounded-md border border-surface-hairline bg-surface-overlay px-2 py-1 text-xs text-gray-200 focus:border-accent focus:outline-none"
              >
                {preps.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-sm text-gray-400 hover:bg-surface-overlay hover:text-white"
              aria-label="Close"
            >
              <Icon icon={X} size={18} />
            </button>
          </div>
        </div>

        {loading && <p className="text-sm text-gray-400">Loading…</p>}

        {signedOut && (
          <p className="text-sm text-gray-400">Sign in to create a prep and track posing progress.</p>
        )}

        {!loading && !signedOut && (
          <>
            <form onSubmit={submitNewPrep} className="mb-4 flex flex-wrap items-end gap-2" data-testid="new-prep-form">
              <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-gray-500">
                New prep
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Nationals"
                  aria-label="Prep name"
                  className="w-44 rounded-md border border-surface-hairline bg-surface-overlay px-2 py-1 text-sm text-gray-100 focus:border-accent focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-gray-500">
                Show date
                <input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  aria-label="Show date"
                  className="rounded-md border border-surface-hairline bg-surface-overlay px-2 py-1 text-sm text-gray-100 focus:border-accent focus:outline-none"
                />
              </label>
              <button
                type="submit"
                disabled={!newName.trim()}
                className="rounded-md bg-surface-overlay px-3 py-1.5 text-xs font-medium text-gray-200 shadow-elev-1 transition ease-spring hover:-translate-y-0.5 hover:text-white disabled:translate-y-0 disabled:opacity-40"
              >
                Create
              </button>
            </form>

            {progress && (
              <div className="mb-3 flex items-baseline justify-between gap-2 border-b border-surface-hairline pb-3">
                <span className="text-sm text-gray-300">{progress.name}</span>
                <span
                  className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent"
                  data-testid="prep-countdown"
                >
                  {countdown(progress.weeks_out)}
                </span>
              </div>
            )}

            <div className="flex-1 space-y-3 overflow-y-auto">
              {progress && progress.poses.length === 0 && (
                <p className="py-8 text-center text-sm text-gray-500" data-testid="prep-empty">
                  No rehearsals tagged to this prep yet. Train in posing mode, then add a session
                  to this prep from your history.
                </p>
              )}
              {preps.length === 0 && !error && (
                <p className="py-8 text-center text-sm text-gray-500">
                  Create a prep above to start tracking your posing progress week over week.
                </p>
              )}
              {progress?.poses.map((pose) => (
                <PoseCard key={pose.pose} pose={pose} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export const PrepProgressPanel = memo(PrepProgressPanelInner)
