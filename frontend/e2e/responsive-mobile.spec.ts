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
