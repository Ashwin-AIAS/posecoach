export const HAPTICS_STORAGE_KEY = "pc.haptics.v1"
export const DEFAULT_REP_VIBRATE_MS = 15

/** True when the browser exposes the Vibration API (false on iOS Safari). */
export function isHapticsSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function"
}

/** Reads the persisted haptics preference from localStorage (defaults to true). */
export function readHapticsEnabled(): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return true
    const raw = window.localStorage.getItem(HAPTICS_STORAGE_KEY)
    if (raw === "0" || raw === "false") return false
    return true
  } catch {
    return true
  }
}

/** Persists the haptics toggle under `pc.haptics.v1` (non-auth UI preference). */
export function writeHapticsEnabled(enabled: boolean): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return
    window.localStorage.setItem(HAPTICS_STORAGE_KEY, enabled ? "1" : "0")
  } catch {
    // Ignore storage quota / private-browsing errors
  }
}

/**
 * Fires a short tactile pulse on rep increment (`navigator.vibrate?.(15)`).
 * Feature-detected no-op on iOS and desktop browsers without Vibration API, or
 * when the user has toggled haptics off.
 */
export function triggerRepHaptic(
  enabled = true,
  durationMs: number = DEFAULT_REP_VIBRATE_MS,
): boolean {
  if (!enabled) return false
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return false
  }
  try {
    return Boolean(navigator.vibrate?.(durationMs))
  } catch {
    return false
  }
}
