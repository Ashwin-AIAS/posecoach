import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { addDays, formatDayLabel, isToday, todayISO } from "../lib/day"

// Freeze "now" at a fixed local time so today/yesterday labels are stable.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 6, 10, 15, 30)) // Fri 10 Jul 2026, 15:30 local
})

afterEach(() => {
  vi.useRealTimers()
})

describe("todayISO", () => {
  it("returns the local calendar day as YYYY-MM-DD", () => {
    expect(todayISO()).toBe("2026-07-10")
  })

  it("stays on the local day just after local midnight", () => {
    vi.setSystemTime(new Date(2026, 6, 10, 0, 5))
    expect(todayISO()).toBe("2026-07-10")
  })
})

describe("addDays", () => {
  it("adds and subtracts within a month", () => {
    expect(addDays("2026-07-10", 1)).toBe("2026-07-11")
    expect(addDays("2026-07-10", -3)).toBe("2026-07-07")
  })

  it("rolls over month boundaries both ways", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01")
    expect(addDays("2026-07-01", -1)).toBe("2026-06-30")
  })

  it("rolls over year boundaries and leap days", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31")
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29") // 2028 is a leap year
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01")
  })

  it("is its own inverse across a DST-window-sized span", () => {
    // 40 days spans any DST change; date-only math must be exact regardless.
    const start = "2026-03-15"
    expect(addDays(addDays(start, 40), -40)).toBe(start)
  })
})

describe("isToday", () => {
  it("is true only for the frozen today", () => {
    expect(isToday("2026-07-10")).toBe(true)
    expect(isToday("2026-07-09")).toBe(false)
    expect(isToday("2026-07-11")).toBe(false)
  })
})

describe("formatDayLabel", () => {
  it("labels today and yesterday", () => {
    expect(formatDayLabel("2026-07-10")).toBe("Today")
    expect(formatDayLabel("2026-07-09")).toBe("Yesterday")
  })

  it("formats other days as 'Wed, 8 Jul'", () => {
    expect(formatDayLabel("2026-07-08")).toBe("Wed, 8 Jul")
    expect(formatDayLabel("2026-01-01")).toBe("Thu, 1 Jan")
  })
})
