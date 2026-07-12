import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Cookie,
  Moon,
  RefreshCw,
  Sun,
  Undo2,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import type { DailyLogOut, LogEntryOut, Meal } from "../types"
import { UnauthenticatedError, friendlyMessage } from "../lib/api"
import { deleteLogEntry, getDailyLog } from "../lib/nutritionApi"
import { addDays, formatDayLabel, isToday, todayISO } from "../lib/day"
import { asMeal, fmt, MEAL_LABELS, MEALS, sumTotals } from "../lib/macros"
import { AddToDiarySheet } from "./AddToDiarySheet"
import { DiaryEntryRow } from "./DiaryEntryRow"
import { SignInPrompt } from "./SignInPrompt"
import { Icon } from "./ui/Icon"

interface DiaryDayProps {
  /** The viewed diary day (`YYYY-MM-DD`) — owned by CaloriesPanel. */
  readonly dateISO: string
  readonly onDateChange: (iso: string) => void
  /** Launches the add-food flow (scan / search / manual) for this day. */
  readonly onAddFood: () => void
  /** Deep-links to Settings when the diary load 401s (P29). */
  readonly onSignIn?: () => void
}

/** How long the Undo affordance stays before the DELETE is actually sent. */
const UNDO_MS = 5000

const MEAL_ICONS: Record<Meal, LucideIcon> = {
  breakfast: Coffee,
  lunch: Sun,
  dinner: Moon,
  snack: Cookie,
}

/** jsdom (tests) and very old browsers lack matchMedia — treat as reduced motion. */
function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== "function") return true
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

const COUNT_UP_MS = 450

/** Counts from the previous displayed value to `target`; snaps when reduced. */
function useCountUp(target: number): number {
  const reduced = prefersReducedMotion()
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)

  useEffect(() => {
    if (reduced) {
      fromRef.current = target
      setValue(target)
      return
    }
    const from = fromRef.current
    if (from === target) return
    const start = performance.now()
    let frame = 0
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(from + (target - from) * eased)
      if (t < 1) {
        frame = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, reduced])

  return value
}

const NAV_BTN =
  "grid h-11 w-11 place-content-center rounded-full text-gray-300 shadow-elev-1 transition ease-spring hover:text-white active:scale-[0.95] disabled:opacity-30 disabled:shadow-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
const PRIMARY_BTN =
  "flex min-h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-gray-950 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"

interface PendingDelete {
  readonly entry: LogEntryOut
  readonly index: number
  readonly timer: number
}

function MacroBar({ label, grams, share }: { label: string; grams: number; share: number }): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-xs text-gray-400">{label}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
        {/* Width is data-driven — proportion of today's macro grams. */}
        <div className="h-full rounded-full bg-accent" style={{ width: `${share}%` }} />
      </div>
      <span className="hud-numerals w-14 shrink-0 text-right text-xs text-gray-300">{fmt(grams)} g</span>
    </div>
  )
}

/**
 * The Calories tab home (P28): one diary day — date navigation (future-capped),
 * kcal + macro totals, entries grouped by meal, and optimistic edit/delete with
 * Undo. Owns the day's data: refetches whenever `dateISO` changes.
 */
function DiaryDayInner({ dateISO, onDateChange, onAddFood, onSignIn }: DiaryDayProps): JSX.Element {
  const [day, setDay] = useState<DailyLogOut | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [authRequired, setAuthRequired] = useState(false)
  const [editing, setEditing] = useState<LogEntryOut | null>(null)
  const [undoEntry, setUndoEntry] = useState<LogEntryOut | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // Guards against out-of-order responses when paging days quickly.
  const fetchSeq = useRef(0)
  const pendingDelete = useRef<PendingDelete | null>(null)

  // Only trust data fetched for the day we are showing.
  const current = day && day.log_date === dateISO ? day : null

  const load = useCallback(async (): Promise<void> => {
    const seq = ++fetchSeq.current
    setLoading(true)
    setError(null)
    setAuthRequired(false)
    try {
      const d = await getDailyLog(dateISO)
      if (seq === fetchSeq.current) setDay(d)
    } catch (e) {
      if (seq !== fetchSeq.current) return
      setAuthRequired(e instanceof UnauthenticatedError)
      setError(friendlyMessage(e))
    } finally {
      if (seq === fetchSeq.current) setLoading(false)
    }
  }, [dateISO])

  useEffect(() => {
    void load()
  }, [load])

  /** Send a deferred DELETE now — the undo window is over (or we're leaving). */
  const commitPendingDelete = useCallback((): void => {
    const p = pendingDelete.current
    if (!p) return
    window.clearTimeout(p.timer)
    pendingDelete.current = null
    setUndoEntry(null)
    // The row is already gone locally and the user has moved on; a late
    // failure here has nowhere sensible to surface.
    void deleteLogEntry(p.entry.id).catch(() => undefined)
  }, [])

  // Leaving the day (nav or unmount) flushes any pending delete first.
  useEffect(() => () => commitPendingDelete(), [dateISO, commitPendingDelete])

  const restoreEntry = (entry: LogEntryOut, index: number): void => {
    setDay((d) => {
      if (!d || d.log_date !== entry.logged_date) return d
      if (d.entries.some((e) => e.id === entry.id)) return d
      const entries = [...d.entries]
      entries.splice(Math.min(index, entries.length), 0, entry)
      return { ...d, entries }
    })
  }

  const handleDelete = (entry: LogEntryOut): void => {
    if (!current) return
    commitPendingDelete() // one undo window at a time
    setDeleteError(null)
    const index = current.entries.findIndex((e) => e.id === entry.id)
    if (index < 0) return
    setDay({ ...current, entries: current.entries.filter((e) => e.id !== entry.id) })
    const timer = window.setTimeout(() => {
      pendingDelete.current = null
      setUndoEntry(null)
      void deleteLogEntry(entry.id).catch((err) => {
        // Failed DELETE → the row returns with an explanatory note.
        restoreEntry(entry, index)
        setDeleteError((err as Error).message)
      })
    }, UNDO_MS)
    pendingDelete.current = { entry, index, timer }
    setUndoEntry(entry)
  }

  const handleUndo = (): void => {
    const p = pendingDelete.current
    if (!p) return
    window.clearTimeout(p.timer)
    pendingDelete.current = null
    setUndoEntry(null)
    restoreEntry(p.entry, p.index)
  }

  const handleEdited = (updated: LogEntryOut): void => {
    setEditing(null)
    setDay((d) => {
      if (!d) return d
      if (updated.logged_date !== d.log_date)
        return { ...d, entries: d.entries.filter((e) => e.id !== updated.id) }
      return { ...d, entries: d.entries.map((e) => (e.id === updated.id ? updated : e)) }
    })
  }

  // Totals derive from the rows so optimistic edits/deletes stay consistent;
  // on a fresh fetch this equals the server's totals (same snapshot sums).
  const totals = useMemo(() => sumTotals(current?.entries ?? []), [current])
  const animatedKcal = useCountUp(totals.kcal)
  const macroGrams = totals.protein_g + totals.carbs_g + totals.fat_g
  const share = (g: number): number => (macroGrams > 0 ? (g / macroGrams) * 100 : 0)

  const byMeal = useMemo(() => {
    const groups: Record<Meal, LogEntryOut[]> = { breakfast: [], lunch: [], dinner: [], snack: [] }
    for (const e of current?.entries ?? []) groups[asMeal(e.meal)].push(e)
    return groups
  }, [current])

  return (
    <div data-testid="diary-day">
      {/* ‹ prev · Today · next › — a diary is a record, so the future is off-limits. */}
      <div className="mt-4 flex items-center justify-between gap-2" data-testid="day-nav">
        <button
          type="button"
          onClick={() => onDateChange(addDays(dateISO, -1))}
          className={NAV_BTN}
          aria-label="Previous day"
          data-testid="day-prev"
        >
          <Icon icon={ChevronLeft} size={18} />
        </button>
        <div className="min-w-0 text-center">
          <p className="truncate font-display text-base font-semibold text-gray-100" data-testid="day-label">
            {formatDayLabel(dateISO)}
          </p>
          <button
            type="button"
            onClick={() => onDateChange(todayISO())}
            disabled={isToday(dateISO)}
            className="min-h-6 rounded-full px-2 text-xs font-medium text-accent transition disabled:opacity-30 hover:text-accent/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
            data-testid="day-today"
          >
            Today
          </button>
        </div>
        <button
          type="button"
          onClick={() => onDateChange(addDays(dateISO, 1))}
          disabled={isToday(dateISO)}
          className={NAV_BTN}
          aria-label="Next day"
          data-testid="day-next"
        >
          <Icon icon={ChevronRight} size={18} />
        </button>
      </div>

      {editing && current ? (
        <div className="mt-4">
          <AddToDiarySheet
            food={editing.food}
            dateISO={dateISO}
            editEntry={editing}
            onLogged={handleEdited}
            onCancel={() => setEditing(null)}
          />
        </div>
      ) : (
        <>
          {loading && !current && (
            <div className="mt-4 space-y-3" data-testid="diary-skeleton" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/5 motion-reduce:animate-none" />
              ))}
            </div>
          )}

          {error && authRequired && !current && !loading && (
            <SignInPrompt message="Sign in to see your food diary" onSignIn={onSignIn} />
          )}

          {error && !authRequired && !current && !loading && (
            <div
              className="mt-4 flex flex-col items-center rounded-2xl bg-surface-raised px-6 py-10 text-center shadow-elev-1"
              data-testid="diary-error"
            >
              <p role="alert" className="max-w-xs text-sm text-red-400">
                {error}
              </p>
              <button type="button" onClick={() => void load()} className={`${PRIMARY_BTN} mt-5`} data-testid="diary-retry">
                <Icon icon={RefreshCw} size={16} />
                Retry
              </button>
            </div>
          )}

          {current && (
            <>
              <div className="mt-4 rounded-2xl bg-surface-raised p-4 shadow-elev-1" data-testid="daily-totals">
                <div className="flex items-baseline gap-2">
                  <span className="hud-numerals text-3xl font-semibold text-accent" data-testid="totals-kcal">
                    {fmt(animatedKcal)}
                  </span>
                  <span className="text-sm text-gray-500">kcal</span>
                </div>
                <div className="mt-3 space-y-2">
                  <MacroBar label="Protein" grams={totals.protein_g} share={share(totals.protein_g)} />
                  <MacroBar label="Carbs" grams={totals.carbs_g} share={share(totals.carbs_g)} />
                  <MacroBar label="Fat" grams={totals.fat_g} share={share(totals.fat_g)} />
                </div>
              </div>

              {deleteError && (
                <p role="alert" className="mt-3 text-xs text-red-400" data-testid="delete-error">
                  Couldn&apos;t delete — the entry is back. {deleteError}
                </p>
              )}

              {current.entries.length === 0 ? (
                <div
                  className="mt-4 flex flex-col items-center rounded-2xl bg-surface-raised px-6 py-10 text-center shadow-elev-1"
                  data-testid="diary-empty"
                >
                  <p className="max-w-xs text-sm text-gray-400">
                    Nothing logged {isToday(dateISO) ? "yet today" : "this day"}. Scan a barcode,
                    search a food you&apos;ve used before, or type one in.
                  </p>
                  <button type="button" onClick={onAddFood} className={`${PRIMARY_BTN} mt-6`} data-testid="diary-empty-add">
                    <Icon icon={CalendarPlus} size={18} />
                    Add food
                  </button>
                </div>
              ) : (
                <>
                  {MEALS.map((meal) => {
                    const entries = byMeal[meal]
                    if (entries.length === 0) return null
                    const subtotal = sumTotals(entries)
                    return (
                      <section key={meal} className="mt-4" data-testid={`meal-section-${meal}`}>
                        <header className="flex items-baseline justify-between px-2">
                          <h4 className="flex items-center gap-1.5 font-display text-sm font-semibold text-gray-300">
                            <Icon icon={MEAL_ICONS[meal]} size={14} className="text-gray-500" />
                            {MEAL_LABELS[meal]}
                          </h4>
                          <span className="hud-numerals text-xs text-gray-500" data-testid={`meal-subtotal-${meal}`}>
                            {fmt(subtotal.kcal)} kcal
                          </span>
                        </header>
                        <div className="mt-1.5 divide-y divide-white/5 rounded-2xl bg-surface-raised px-2 py-1 shadow-elev-1">
                          {entries.map((entry) => (
                            <DiaryEntryRow key={entry.id} entry={entry} onEdit={setEditing} onDelete={handleDelete} />
                          ))}
                        </div>
                      </section>
                    )
                  })}
                  <button type="button" onClick={onAddFood} className={`${PRIMARY_BTN} mx-auto mt-6`} data-testid="add-food-btn">
                    <Icon icon={CalendarPlus} size={18} />
                    Add food
                  </button>
                </>
              )}

              {undoEntry && (
                <div
                  className="mt-4 flex items-center justify-between rounded-full bg-surface-raised py-1.5 pl-4 pr-1.5 shadow-elev-2"
                  data-testid="undo-bar"
                >
                  <span className="truncate text-xs text-gray-400">{undoEntry.food.name} removed</span>
                  <button
                    type="button"
                    onClick={handleUndo}
                    className="flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-accent transition ease-spring active:scale-[0.95] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
                    data-testid="undo-btn"
                  >
                    <Icon icon={Undo2} size={14} />
                    Undo
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

export const DiaryDay = memo(DiaryDayInner)
