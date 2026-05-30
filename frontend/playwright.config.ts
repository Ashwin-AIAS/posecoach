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
  },
})
