import { describe, expect, it } from "vitest"

import { isOverlayNeonEnabled } from "../flag"

function env(overrides: Partial<ImportMetaEnv>): ImportMetaEnv {
  return { DEV: false, PROD: true, SSR: false, MODE: "production", BASE_URL: "/", ...overrides } as ImportMetaEnv
}

describe("isOverlayNeonEnabled", () => {
  it("defaults on in dev when unset", () => {
    expect(isOverlayNeonEnabled(env({ DEV: true }))).toBe(true)
  })

  it("defaults off in prod when unset", () => {
    expect(isOverlayNeonEnabled(env({ DEV: false }))).toBe(false)
  })

  it("forces on in prod when explicitly set to a truthy value", () => {
    expect(isOverlayNeonEnabled(env({ DEV: false, VITE_OVERLAY_NEON: "true" }))).toBe(true)
  })

  it("forces off in dev when explicitly set to \"false\"", () => {
    expect(isOverlayNeonEnabled(env({ DEV: true, VITE_OVERLAY_NEON: "false" }))).toBe(false)
  })
})
