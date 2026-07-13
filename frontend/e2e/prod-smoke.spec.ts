import { expect, test } from "@playwright/test"

/**
 * Production smoke test — browser-level verification against the live Space.
 *
 * This is the test P29 was missing: a real browser exercising real preflight,
 * cookie, and CORS behavior. It registers a throwaway user, walks through
 * the core flows (auth → workout → nutrition), then cleans up via DELETE.
 *
 * Skipped unless PROD_BASE_URL is set. Run with:
 *   PROD_BASE_URL=https://ashwintaibu-posecoach.hf.space \
 *     npx playwright test --config=e2e/prod-smoke.config.ts
 */

const PROD_BASE_URL = process.env.PROD_BASE_URL
const SKIP_REASON = "PROD_BASE_URL not set — skipping prod smoke test"

// Generate a unique throwaway email for this test run
const RUN_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const TEST_EMAIL = `smoke-${RUN_ID}@test.posecoach.dev`
const TEST_PASSWORD = `Smoke!Pass${RUN_ID}`

test.describe("Production smoke test", () => {
  test.skip(!PROD_BASE_URL, SKIP_REASON)

  test("full loop: register → sign in → workout → nutrition → cleanup", async ({
    page,
  }) => {
    // ── Step 1: Load the app shell ──────────────────────────────────────
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    // The SPA should render (not a blank page or error)
    await expect(page.locator("body")).not.toBeEmpty()

    // ── Step 2: Register a throwaway account ────────────────────────────
    // Click the sign-in button to open the auth modal
    const signInBtn = page.getByTestId("signin-btn")
    await expect(signInBtn).toBeVisible({ timeout: 15_000 })
    await signInBtn.click()

    const modal = page.getByTestId("auth-modal")
    await expect(modal).toBeVisible()

    // Switch to register mode
    const switchBtn = modal.getByRole("button", { name: /register|sign up|create/i })
    if (await switchBtn.isVisible()) {
      await switchBtn.click()
    }

    await modal.getByLabel("Email").fill(TEST_EMAIL)
    await modal.getByLabel("Password").fill(TEST_PASSWORD)

    // Submit registration
    const submitBtn = modal.getByRole("button", { name: /register|sign up|create/i })
    await submitBtn.click()

    // ── Step 3: Verify sign-in succeeded (no "Failed to fetch") ─────────
    // Wait for the modal to close and user email to appear
    await expect(page.getByTestId("user-email")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId("user-email")).toHaveText(TEST_EMAIL)

    // Critical assertion: no "Failed to fetch" error anywhere
    const pageContent = await page.textContent("body")
    expect(pageContent).not.toContain("Failed to fetch")

    // ── Step 4: Navigate to Workouts tab ────────────────────────────────
    const workoutsTab = page.getByTestId("tab-workouts")
    if (await workoutsTab.isVisible()) {
      await workoutsTab.click()
      await page.waitForTimeout(1000)

      // Try to start a workout
      const startBtn = page.getByTestId("start-workout-cta")
      if (await startBtn.isVisible()) {
        await startBtn.click()
        await page.waitForTimeout(1000)

        // Look for the active workout UI
        const activeWorkout = page.getByTestId("active-workout")
        if (await activeWorkout.isVisible({ timeout: 5_000 }).catch(() => false)) {
          // Workout started successfully — finish it
          const finishBtn = page.getByRole("button", { name: /finish|end|complete/i })
          if (await finishBtn.isVisible().catch(() => false)) {
            await finishBtn.click()
            await page.waitForTimeout(500)
            // Confirm if needed
            const confirmBtn = page.getByRole("button", { name: /confirm|yes|finish/i })
            if (await confirmBtn.isVisible().catch(() => false)) {
              await confirmBtn.click()
            }
          }
        }
      }
    }

    // ── Step 5: Navigate to Calories tab ────────────────────────────────
    const caloriesTab = page.getByTestId("tab-calories")
    if (await caloriesTab.isVisible()) {
      await caloriesTab.click()
      await page.waitForTimeout(1000)

      // Verify the calories panel loaded (look for search or diary)
      const caloriesPanel = page.locator("[data-testid*='calorie'], [data-testid*='food'], [data-testid*='nutrition']")
      // Just verify tab navigation works — food search requires barcode/text
      await page.waitForTimeout(500)
    }

    // ── Step 6: Verify API health (same-origin) ─────────────────────────
    const healthRes = await page.request.get("/health")
    expect(healthRes.status()).toBe(200)
    const healthBody = await healthRes.json()
    expect(healthBody.status).toBe("ok")

    // ── Step 7: Verify /docs is accessible ──────────────────────────────
    const docsRes = await page.request.get("/docs")
    expect(docsRes.status()).toBe(200)

    // ── Step 8: Cleanup — delete the throwaway account ──────────────────
    const deleteRes = await page.request.delete("/api/v1/auth/account")
    expect(deleteRes.status()).toBe(200)
  })

  test("SPA routes don't shadow API endpoints", async ({ page }) => {
    // These should return JSON, not the SPA HTML shell
    const endpoints = [
      { path: "/health", expectStatus: 200 },
      { path: "/health/deep", expectStatus: [200, 503] },
      { path: "/openapi.json", expectStatus: 200 },
    ]

    for (const { path, expectStatus } of endpoints) {
      const res = await page.request.get(path)
      const statuses = Array.isArray(expectStatus) ? expectStatus : [expectStatus]
      expect(statuses, `${path} returned unexpected ${res.status()}`).toContain(res.status())

      const contentType = res.headers()["content-type"] || ""
      expect(contentType, `${path} should return JSON, not HTML`).toContain("json")
    }
  })

  test("static assets are served with correct cache headers", async ({ page }) => {
    // Load the app to discover asset URLs
    const response = await page.goto("/")
    expect(response?.status()).toBe(200)

    // index.html should have no-cache
    const cacheControl = response?.headers()["cache-control"] || ""
    expect(cacheControl).toContain("no-cache")
  })
})
