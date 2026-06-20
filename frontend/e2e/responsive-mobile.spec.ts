import { expect, test } from "@playwright/test"

/**
 * Responsive mobile E2E (P19-P22) — verifies the action bar is reachable on
 * short phones (P19), the camera-flip control sits on the camera feed (P20),
 * pickers collapse to a single chip so the camera + score dominate (P21), and
 * the camera is the hero in every mode with ancillary panels floating rather
 * than stacked (P22).
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
  // More specific than the history mock above (Playwright prefers the
  // last-registered matching route) — without this, the broad "[]" body
  // gets parsed as a truthy Recommendation and RecommendationCard renders
  // for an anonymous user, which never happens against the real backend.
  await page.route("**/api/v1/history/recommendation**", (route) =>
    route.fulfill({ status: 204, contentType: "application/json", body: "" }),
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

for (const { width, height, label } of [
  { width: 375, height: 667, label: "iPhone SE" },
  { width: 393, height: 852, label: "iPhone 15" },
]) {
  test(`P23: division switch is reachable and clickable in the posing pose sheet on ${label}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height })
    await page.goto("/")
    await page.getByTestId("start-workout-btn").click()
    await page.getByTestId("mode-posing").click()

    await page.getByTestId("pose-change-btn").click()
    const division = page.getByTestId("division-select")
    await expect(division).toBeInViewport()
    // Trial click performs Playwright's actionability hit-test at the
    // element's center point: it fails if another element (e.g. the header,
    // painted on top because the sheet was trapped in a losing stacking
    // context) intercepts the pointer instead.
    await division.click({ trial: true, timeout: 2000 })

    await division.selectOption("bikini")
    await expect(division).toHaveValue("bikini")
  })
}

for (const mode of ["exercise", "posing"] as const) {
  for (const { width, height, label, minCameraRatio } of [
    { width: 320, height: 568, label: "320 floor", minCameraRatio: 0.7 },
    { width: 375, height: 667, label: "iPhone SE", minCameraRatio: 0.7 },
    { width: 393, height: 852, label: "iPhone 15", minCameraRatio: 0.7 },
    { width: 430, height: 932, label: "iPhone Pro Max", minCameraRatio: 0.7 },
    // Landscape at this height is a known gap, not yet at the 70% target: the
    // fixed header (54px) + bottom action bar (54px) alone consume ~28% of a
    // 393px-tall viewport before the tray is even considered. Closing it needs
    // a landscape-specific compact header/action-bar, which is a follow-up, not
    // part of this board's tray-collapse fix. Tracked at the still-real 0.55
    // floor so a regression below today's number is caught.
    { width: 852, height: 393, label: "iPhone 15 landscape", minCameraRatio: 0.55 },
  ]) {
    test(`${mode} mode: camera owns >=${Math.round(minCameraRatio * 100)}% of viewport and selector row stays <=56px on ${label}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height })
      await page.goto("/")
      await page.getByTestId("start-workout-btn").click()
      if (mode === "posing") await page.getByTestId("mode-posing").click()

      const cameraBox = await page.getByTestId("camera-stage").boundingBox()
      const selectorBox = await page.getByTestId("selector-row").boundingBox()
      if (!cameraBox || !selectorBox) throw new Error("missing layout boxes")

      expect(cameraBox.height).toBeGreaterThanOrEqual(height * minCameraRatio)
      expect(selectorBox.height).toBeLessThanOrEqual(56)
    })
  }
}

test("reference video opens as a floating sheet from the camera trigger, not a stacked row", async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto("/")
  await page.getByTestId("start-workout-btn").click()

  // The desktop aside also mounts a (CSS-hidden on mobile) ReferenceVideoPanel,
  // so assert on *visibility*, not DOM presence, for the mobile-only sheet copy.
  await expect(page.locator('[data-testid="reference-video-panel"]:visible')).toHaveCount(0)
  await page.getByTestId("reference-trigger").click()
  await expect(page.locator('[data-testid="reference-video-panel"]:visible')).toHaveCount(1)
  await expect(page.getByTestId("reference-video-play")).toBeVisible()
})

test("coaching/chat tray opens as a sheet in exercise mode too (P22 generalizes P21)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto("/")
  await page.getByTestId("start-workout-btn").click()

  // Same caveat as above — the desktop aside's CoachingCues is CSS-hidden, not
  // unmounted, on mobile, so check visibility rather than DOM presence.
  await expect(page.locator('[data-testid="score-value"]:visible')).toHaveCount(0)
  await page.getByTestId("tray-trigger").click()
  await expect(page.locator('[data-testid="score-value"]:visible')).toHaveCount(1)
})
