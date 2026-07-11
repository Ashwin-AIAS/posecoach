/**
 * Pure local-date helpers for the diary's day navigation (P28).
 *
 * Dates are `YYYY-MM-DD` strings in LOCAL time — "today" must match the day
 * the user is experiencing, and `logged_date` is a date (never a timestamp),
 * so UTC conversions would drift around midnight. Calendar arithmetic goes
 * through the Date(y, m, d) constructor, which normalizes overflow
 * (month/year rollover) and is immune to DST hour shifts.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const

function toISO(d: Date): string {
  const y = String(d.getFullYear()).padStart(4, "0")
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function parseISO(iso: string): Date {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number)
  // Noon avoids any midnight/DST edge when the Date is only read back as y/m/d.
  return new Date(y, m - 1, d, 12)
}

/** Today's local date as `YYYY-MM-DD`. */
export function todayISO(): string {
  return toISO(new Date())
}

/** `iso` shifted by `n` calendar days (n may be negative). */
export function addDays(iso: string, n: number): string {
  const d = parseISO(iso)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

/** Whether `iso` is the user's current local day. */
export function isToday(iso: string): boolean {
  return iso === todayISO()
}

/** "Today" / "Yesterday" / "Mon, 8 Jul" — deterministic, English-only. */
export function formatDayLabel(iso: string): string {
  if (isToday(iso)) return "Today"
  if (iso === addDays(todayISO(), -1)) return "Yesterday"
  const d = parseISO(iso)
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`
}
