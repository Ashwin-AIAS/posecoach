import { memo, useMemo } from "react"
import { Flame } from "lucide-react"

import type { HistorySessionRow } from "../../hooks/useHistorySessions"
import { startOfIsoWeek } from "../../lib/insights"
import { Icon } from "../../components/ui/Icon"

interface WeekStripProps {
  readonly sessions: readonly HistorySessionRow[]
  readonly streak: number
  /** Optional reference date for deterministic tests. */
  readonly now?: Date
}

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const
const FULL_DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/**
 * 7-day Mon–Sun activity strip with streak badge (P36 C2).
 * Filled dots use the brand accent colour (never the form-score ramp).
 */
function WeekStripInner({ sessions, streak, now }: WeekStripProps): JSX.Element {
  const days = useMemo(() => {
    const ref = now ?? new Date()
    const monday = startOfIsoWeek(ref)
    const todayKey = dayKey(ref)
    const activeKeys = new Set(sessions.map((s) => dayKey(new Date(s.started_at))))

    return DAY_LABELS.map((shortLabel, idx) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + idx)
      const k = dayKey(d)
      return {
        shortLabel,
        fullName: FULL_DAY_NAMES[idx],
        active: activeKeys.has(k),
        isToday: k === todayKey,
      }
    })
  }, [sessions, now])

  return (
    <div
      className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-surface-raised px-4 py-3 shadow-elev-1"
      data-testid="week-strip"
    >
      <div className="flex items-center gap-2.5 sm:gap-3.5" role="list" aria-label="This week">
        {days.map((d, idx) => (
          <div
            key={`${d.fullName}-${idx}`}
            role="listitem"
            className="flex flex-col items-center gap-1.5"
            aria-label={`${d.fullName}${d.active ? ", trained" : ", rest"}`}
          >
            <span
              className={
                "h-2.5 w-2.5 rounded-full transition-colors " +
                (d.active
                  ? "bg-accent shadow-glow-sm"
                  : d.isToday
                    ? "bg-surface-overlay ring-2 ring-accent/60"
                    : "bg-surface-overlay")
              }
              data-testid={`week-dot-${idx}`}
              data-active={d.active ? "true" : "false"}
            />
            <span
              className={
                "text-[10px] font-medium " +
                (d.isToday ? "text-white" : "text-gray-500")
              }
            >
              {d.shortLabel}
            </span>
          </div>
        ))}
      </div>

      <div
        className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1"
        data-testid="week-streak-badge"
      >
        <Icon icon={Flame} size={14} className="text-accent" />
        <span className="hud-numerals font-display text-xs font-semibold text-white">
          {streak}
        </span>
        <span className="text-[11px] text-gray-300">
          {streak === 1 ? "day" : "days"}
        </span>
      </div>
    </div>
  )
}

export const WeekStrip = memo(WeekStripInner)
