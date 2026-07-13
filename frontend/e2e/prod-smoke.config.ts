import { defineConfig } from "@playwright/test"

/**
 * Playwright config for the production smoke test.
 *
 * Runs against a live deployment (no dev server, no mocks).
 * Requires PROD_BASE_URL to be set, e.g.:
 *   PROD_BASE_URL=https://ashwintaibu-posecoach.hf.space npx playwright test --config=e2e/prod-smoke.config.ts
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "prod-smoke.spec.ts",
  fullyParallel: false,       // serial — each step depends on the previous
  retries: 0,                 // fail fast against prod
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,            // generous timeout for cold HF Space
  use: {
    baseURL: process.env.PROD_BASE_URL || "https://ashwintaibu-posecoach.hf.space",
    trace: "retain-on-failure",
    // Real browser with no mocks — full cookie / CORS / preflight behavior
    bypassCSP: false,
  },
  projects: [
    {
      name: "chromium",
      use: { channel: "chromium" },
    },
  ],
  // No webServer — we test against a live deployment
})
