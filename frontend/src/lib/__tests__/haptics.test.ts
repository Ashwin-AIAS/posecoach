import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  DEFAULT_REP_VIBRATE_MS,
  HAPTICS_STORAGE_KEY,
  isHapticsSupported,
  readHapticsEnabled,
  triggerRepHaptic,
  writeHapticsEnabled,
} from "../haptics"

describe("haptics (P36 A4)", () => {
  const originalVibrate = navigator.vibrate

  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    Object.defineProperty(navigator, "vibrate", {
      value: originalVibrate,
      configurable: true,
      writable: true,
    })
    vi.restoreAllMocks()
  })

  it("is a safe no-op when navigator.vibrate is absent (iOS path)", () => {
    Object.defineProperty(navigator, "vibrate", {
      value: undefined,
      configurable: true,
      writable: true,
    })
    expect(isHapticsSupported()).toBe(false)
    expect(() => triggerRepHaptic(true)).not.toThrow()
    expect(triggerRepHaptic(true)).toBe(false)
  })

  it("calls navigator.vibrate(15) when supported and enabled, and skips when disabled", () => {
    const vibrateMock = vi.fn(() => true)
    Object.defineProperty(navigator, "vibrate", {
      value: vibrateMock,
      configurable: true,
      writable: true,
    })

    expect(isHapticsSupported()).toBe(true)
    expect(triggerRepHaptic(false)).toBe(false)
    expect(vibrateMock).not.toHaveBeenCalled()

    expect(triggerRepHaptic(true)).toBe(true)
    expect(vibrateMock).toHaveBeenCalledWith(DEFAULT_REP_VIBRATE_MS)
  })

  it("persists the haptics toggle under pc.haptics.v1", () => {
    expect(readHapticsEnabled()).toBe(true)

    writeHapticsEnabled(false)
    expect(window.localStorage.getItem(HAPTICS_STORAGE_KEY)).toBe("0")
    expect(readHapticsEnabled()).toBe(false)

    writeHapticsEnabled(true)
    expect(window.localStorage.getItem(HAPTICS_STORAGE_KEY)).toBe("1")
    expect(readHapticsEnabled()).toBe(true)
  })
})
