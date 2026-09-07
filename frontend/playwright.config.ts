import { defineConfig, devices } from "@playwright/test"

/**
 * Playwright E2E config — runs against the Vite dev server.
 *
 * All backend calls are mocked via `page.route()` in each spec, so the
 * specs do NOT require the FastAPI backend, Postgres, Redis, or a real
 * YOLO model to be running.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // UI-11: VITE_OVERLAY_NEON defaults on in dev (features/coach/overlay/flag.ts)
    // so an interactive `npm run dev` shows the new overlay immediately. Pin it
    // off for the e2e server specifically so the legacy pose_overlay.spec.ts
    // (which asserts on the old overlay's data-testid) stays deterministic —
    // it never exercises the flag itself. e2e/pose_overlay_neon.spec.ts is
    // unaffected either way: it mounts PoseOverlayNeon directly via
    // overlay-preview.html, bypassing the flag/App.tsx entirely.
    //
    // P29 S8: VITE_VOICE_BOOT_CARD (features/voice/flag.ts) defaults on the
    // same way. Pinned off here for the identical reason — the boot card's
    // fixed full-screen backdrop would otherwise intercept the first click
    // of every pre-P29 spec that enters the live view. e2e/voice-live-wiring.spec.ts
    // forces it back on per-page-load via the flag's `?voiceBoot=1` override
    // instead of needing its own dev server.
    env: { VITE_OVERLAY_NEON: "false", VITE_VOICE_BOOT_CARD: "false" },
  },
})
