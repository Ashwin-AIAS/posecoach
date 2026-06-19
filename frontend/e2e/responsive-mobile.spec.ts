import { expect, test } from "@playwright/test"

/**
 * Responsive mobile E2E (P19-P21) — verifies the action bar is reachable on
 * short phones (P19), the camera-flip control sits on the camera feed (P20),
 * and pickers collapse to a single chip so the camera + score dominate (P21).
 *
 * Backend is mocked — no FastAPI / Postgres / model required.
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

for (const { width, height, label } of [
  { width: 375, height: 667, label: "iPhone SE" },
  { width: 393, height: 852, label: "iPhone 15" },
]) {
  test(`finish-set bar is reachable without scrolling on ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto("/")
    await page.getByTestId("start-workout-btn").click()

    await expect(page.getByTestId("finish-set-btn")).toBeInViewport()
    await expect(page.getByTestId("flip-camera")).toBeInViewport()
  })
}

test("camera flip control lives on the camera feed, not the header", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto("/")
  await page.getByTestId("start-workout-btn").click()

  const header = page.locator("header")
  await expect(header.getByTestId("flip-camera")).toHaveCount(0)
  await expect(page.getByTestId("flip-camera")).toBeVisible()
})

test("posing mode selector row collapses to a single line, leaving more room for the camera", async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto("/")
  await page.getByTestId("start-workout-btn").click()

  await page.getByTestId("mode-posing").click()
  await expect(page.getByRole("radiogroup", { name: "Pose" })).toHaveCount(0)
  await expect(page.getByTestId("pose-current-label")).toBeVisible()

  await page.getByTestId("pose-change-btn").click()
  await expect(page.getByRole("radiogroup", { name: "Pose" })).toBeVisible()
})

for (const { width, height, label, minCameraRatio } of [
  { width: 320, height: 568, label: "320 floor", minCameraRatio: 0.7 },
  { width: 375, height: 667, label: "iPhone SE", minCameraRatio: 0.7 },
  { width: 393, height: 852, label: "iPhone 15", minCameraRatio: 0.7 },
  { width: 430, height: 932, label: "iPhone Pro Max", minCameraRatio: 0.7 },
  // Landscape at this height is a known gap, not yet at the 70% target: the
  // fixed header (54px) + bottom action bar (54px) alone consume ~28% of a
  // 393px-tall viewport before the tray is even considered. Closing it needs
  // a landscape-specific compact header/action-bar, which is a follow-up, not
  // part of the P21 tray-collapse fix. Tracked at the still-real 0.55 floor
  // so a regression below today's number is caught.
  { width: 852, height: 393, label: "iPhone 15 landscape", minCameraRatio: 0.55 },
]) {
  test(`posing mode: camera owns >=${Math.round(minCameraRatio * 100)}% of viewport and selector row stays <=56px on ${label}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height })
    await page.goto("/")
    await page.getByTestId("start-workout-btn").click()
    await page.getByTestId("mode-posing").click()

    const cameraBox = await page.getByTestId("camera-stage").boundingBox()
    const selectorBox = await page.getByTestId("selector-row").boundingBox()
    if (!cameraBox || !selectorBox) throw new Error("missing layout boxes")

    expect(cameraBox.height).toBeGreaterThanOrEqual(height * minCameraRatio)
    expect(selectorBox.height).toBeLessThanOrEqual(56)
  })
}
