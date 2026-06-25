import { expect, test } from "@playwright/test"

/**
 * P23.1 — the fixed PWA InstallBanner must sit ABOVE the bottom tab bar and
 * never overlap it. When the tab bar is hidden (a live set) the banner falls
 * back to its own bottom spacing.
 *
 * Backend is mocked. The install banner is forced on by dispatching Chromium's
 * `beforeinstallprompt` event (useInstallPrompt captures it → "native" mode).
 */

test.beforeEach(async ({ page }) => {
  await page.context().grantPermissions(["camera"])
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  )
  await page.route("**/api/v1/history**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  )
})

test("install banner sits above the bottom tab bar, never overlapping it", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto("/")

  // App ready on the Coach tab (tab bar visible) before forcing the banner.
  await expect(page.getByTestId("tab-bar")).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event("beforeinstallprompt")))

  const banner = page.getByTestId("install-banner")
  await expect(banner).toBeVisible()
  const tabBar = page.getByTestId("tab-bar")

  // The banner's bottom edge clears the tab bar's top edge (no overlap).
  await expect
    .poll(async () => {
      const b = await banner.boundingBox()
      const t = await tabBar.boundingBox()
      if (!b || !t) return null
      return b.y + b.height <= t.y
    })
    .toBe(true)
})

test("during a live set the tab bar is hidden and the banner is unaffected", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto("/")
  await page.getByTestId("start-workout-btn").click()

  // Live set → tab bar removed from the DOM; --tabbar-h collapses to 0px.
  await expect(page.getByTestId("tab-bar")).toHaveCount(0)
  await page.evaluate(() => window.dispatchEvent(new Event("beforeinstallprompt")))

  const banner = page.getByTestId("install-banner")
  await expect(banner).toBeVisible()

  // With no bar, the banner sits near the viewport bottom (its own spacing).
  await expect
    .poll(async () => {
      const b = await banner.boundingBox()
      return b ? b.y + b.height : null
    })
    .toBeGreaterThan(852 - 120)
})
