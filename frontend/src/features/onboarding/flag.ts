/**
 * Resolves the VITE_ONBOARDING feature flag (P36 integration) — mirrors
 * `features/voice/flag.ts`'s `VITE_VOICE_BOOT_CARD` precedent exactly.
 *
 * First-run onboarding is on in every environment. Setting `VITE_ONBOARDING`
 * to the literal string `"false"` is the escape hatch: the shared e2e dev
 * server pins it off in `playwright.config.ts`, because every Playwright
 * context starts with empty `localStorage` and the full-screen onboarding
 * flow would otherwise intercept each pre-P36 spec's first click.
 *
 * A `?onboarding=1`/`?onboarding=0` query param (persisted to localStorage)
 * overrides that default for one browser without touching the env.
 */
const OVERRIDE_STORAGE_KEY = "pc.onboarding.override"

export function isOnboardingEnabled(env: ImportMetaEnv = import.meta.env): boolean {
  if (typeof window !== "undefined") {
    try {
      const qp = new URLSearchParams(window.location.search).get("onboarding")
      if (qp === "1") window.localStorage.setItem(OVERRIDE_STORAGE_KEY, "1")
      else if (qp === "0") window.localStorage.setItem(OVERRIDE_STORAGE_KEY, "0")
      const stored = window.localStorage.getItem(OVERRIDE_STORAGE_KEY)
      if (stored === "1") return true
      if (stored === "0") return false
    } catch {
      // Storage unavailable (private mode) — fall through to the env default.
    }
  }
  return (env.VITE_ONBOARDING as string | undefined) !== "false"
}
