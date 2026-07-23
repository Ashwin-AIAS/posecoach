import { expect, test } from "@playwright/test"

/**
 * P34 — every tab's panel header (and the back controls inside them) must carry
 * a top inset that clears the notch: `paddingTop: max(<base>, env(safe-area-inset-top))`.
 * On a non-notched headless Chromium `env(safe-area-inset-top)` resolves to 0, so
 * a real notch render is a device-only check; what this spec locks in
 * deterministically is that the inset is actually *wired* on each header (the
 * regression that shipped the overlap) and that the back controls are reachable
 * on a phone viewport.
 *
 * Backend is mocked — no FastAPI / Postgres / model required.
 */

const AUTH_USER = { id: "u1", email: "tester@example.com" }
const WORKOUT = {
  id: "w1",
  title: "Push Day",
  notes: null,
  started_at: new Date().toISOString(),
  ended_at: null,
  exercises: [],
}

test.beforeEach(async ({ page }) => {
  await page.context().grantPermissions(["camera"])
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(AUTH_USER) }),
  )
  await page.route("**/api/v1/history**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  )
  // Workout logger reads (list, routines, exercises) → empty; create → a workout.
  await page.route("**/api/v1/workouts/workouts", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(WORKOUT) })
      : route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  )
  await page.route("**/api/v1/workouts/routines", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  )
  await page.route("**/api/v1/workouts/exercises**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  )
})

/** Read the inline paddingTop of the element (empty string if unset). */
async function inlinePaddingTop(page: import("@playwright/test").Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((el) => (el as HTMLElement).style.paddingTop)
}

const INSET = "env(safe-area-inset-top)"

test("Workouts landing + library headers carry the safe-area top inset, back button reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto("/")
  await page.getByTestId("tab-workouts").click()

  // Landing header (the panel root's first child) has the inset wired.
  await expect(page.getByTestId("workout-panel")).toBeVisible()
  expect(await inlinePaddingTop(page, '[data-testid="workout-panel"] > div')).toContain(INSET)

  // Library sub-view: the "← Workouts" back control was the one hiding under the
  // notch — its header must be inset, and the control must sit in the viewport.
  await page.getByTestId("browse-exercises-btn").click()
  const back = page.getByRole("button", { name: "Back to workouts" })
  await expect(back).toBeVisible()
  await expect(back).toBeInViewport()
  expect(await inlinePaddingTop(page, '[data-testid="workout-panel"] > div')).toContain(INSET)
})

test("Active workout header is inset and its back (minimize) control is reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto("/")
  await page.getByTestId("tab-workouts").click()
  await page.getByTestId("start-workout-cta").click()

  await expect(page.getByTestId("active-workout")).toBeVisible()
  const minimize = page.getByTestId("minimize-workout-btn")
  await expect(minimize).toBeVisible()
  await expect(minimize).toBeInViewport()
  expect(await inlinePaddingTop(page, '[data-testid="active-workout"] > div')).toContain(INSET)
})

test("Calories and Settings panel roots carry the safe-area top inset", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto("/")

  await page.getByTestId("tab-calories").click()
  await expect(page.getByTestId("calories-panel")).toBeVisible()
  expect(await inlinePaddingTop(page, '[data-testid="calories-panel"]')).toContain(INSET)

  await page.getByTestId("tab-settings").click()
  await expect(page.getByTestId("settings-panel")).toBeVisible()
  expect(await inlinePaddingTop(page, '[data-testid="settings-panel"]')).toContain(INSET)
})
