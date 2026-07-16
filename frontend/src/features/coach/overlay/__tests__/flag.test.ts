import { describe, expect, it } from "vitest"

import { isOverlayNeonEnabled } from "../flag"

function env(overrides: Partial<ImportMetaEnv>): ImportMetaEnv {
  return { DEV: false, PROD: true, SSR: false, MODE: "production", BASE_URL: "/", ...overrides } as ImportMetaEnv
}

describe("isOverlayNeonEnabled", () => {
  it("defaults on in dev when unset", () => {
    expect(isOverlayNeonEnabled(env({ DEV: true }))).toBe(true)
  })

  it("defaults on in prod when unset (UI-11 cutover)", () => {
    expect(isOverlayNeonEnabled(env({ DEV: false }))).toBe(true)
  })

  it("stays on in prod when explicitly set to a truthy value", () => {
    expect(isOverlayNeonEnabled(env({ DEV: false, VITE_OVERLAY_NEON: "true" }))).toBe(true)
  })

  it("forces off in prod when explicitly set to \"false\" (escape hatch)", () => {
    expect(isOverlayNeonEnabled(env({ DEV: false, VITE_OVERLAY_NEON: "false" }))).toBe(false)
  })

  it("forces off in dev when explicitly set to \"false\"", () => {
    expect(isOverlayNeonEnabled(env({ DEV: true, VITE_OVERLAY_NEON: "false" }))).toBe(false)
  })
})
