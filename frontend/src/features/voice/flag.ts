/**
 * Resolves the VITE_VOICE_BOOT_CARD feature flag (P29 S8) — mirrors
 * `features/coach/overlay/flag.ts`'s `VITE_OVERLAY_NEON` precedent exactly.
 *
 * The boot card is the default in every environment. Setting
 * `VITE_VOICE_BOOT_CARD` to the literal string `"false"` is the escape
 * hatch: the shared e2e dev server pins it off in `playwright.config.ts`
 * because the general e2e suite predates P29 and assumes the live view is
 * immediately interactive (a fixed full-screen `BootCard` would otherwise
 * intercept every one of those specs' first click).
 *
 * A `?voiceBoot=1`/`?voiceBoot=0` query param (persisted to `localStorage`,
 * same convention as `useLatencyProbe.isLatencyDiagEnabled`'s `?diag=`) lets
 * one page load override that shared default without touching the env —
 * `e2e/voice-live-wiring.spec.ts` uses this to force the card back on
 * against the otherwise-pinned-off e2e server.
 */
const OVERRIDE_STORAGE_KEY = "pc.voice.bootcard.override"

export function isVoiceBootCardEnabled(env: ImportMetaEnv = import.meta.env): boolean {
  if (typeof window !== "undefined") {
    try {
      const qp = new URLSearchParams(window.location.search).get("voiceBoot")
      if (qp === "1") window.localStorage.setItem(OVERRIDE_STORAGE_KEY, "1")
      else if (qp === "0") window.localStorage.setItem(OVERRIDE_STORAGE_KEY, "0")
      const stored = window.localStorage.getItem(OVERRIDE_STORAGE_KEY)
      if (stored === "1") return true
      if (stored === "0") return false
    } catch {
      // Storage unavailable (private mode) — fall through to the env default.
    }
  }
  return (env.VITE_VOICE_BOOT_CARD as string | undefined) !== "false"
}
