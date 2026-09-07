import { afterEach, describe, expect, it } from "vitest"

import { isVoiceBootCardEnabled } from "../flag"

function env(overrides: Partial<ImportMetaEnv> = {}): ImportMetaEnv {
  return { DEV: false, PROD: true, SSR: false, MODE: "production", BASE_URL: "/", ...overrides } as ImportMetaEnv
}

afterEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, "", "/")
})

describe("isVoiceBootCardEnabled", () => {
  it("defaults to enabled when no env override is set", () => {
    expect(isVoiceBootCardEnabled(env())).toBe(true)
  })

  it("is disabled when VITE_VOICE_BOOT_CARD is the literal string 'false'", () => {
    expect(isVoiceBootCardEnabled(env({ VITE_VOICE_BOOT_CARD: "false" }))).toBe(false)
  })

  it("is unaffected by any other VITE_VOICE_BOOT_CARD value", () => {
    expect(isVoiceBootCardEnabled(env({ VITE_VOICE_BOOT_CARD: "0" }))).toBe(true)
  })

  it("a ?voiceBoot=0 query param overrides an on-by-default env, persisted across calls", () => {
    window.history.replaceState(null, "", "/?voiceBoot=0")
    expect(isVoiceBootCardEnabled(env())).toBe(false)

    // Persisted to localStorage -- still off on a later call with no query param.
    window.history.replaceState(null, "", "/")
    expect(isVoiceBootCardEnabled(env())).toBe(false)
  })

  it("a ?voiceBoot=1 query param overrides an off env", () => {
    window.history.replaceState(null, "", "/?voiceBoot=1")
    expect(isVoiceBootCardEnabled(env({ VITE_VOICE_BOOT_CARD: "false" }))).toBe(true)
  })
})
