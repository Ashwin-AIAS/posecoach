import { expect, test } from "@playwright/test"

/**
 * Exercise selector E2E — verifies the user can open the categorized grid and
 * switch between exercises (labels mirror EXERCISE_META in src/lib/exercises.ts).
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

test("opening the selector reveals the categorized exercise grid", async ({ page }) => {
  await page.goto("/")

  await page.getByTestId("exercise-change-btn").click()
  const group = page.getByRole("radiogroup", { name: "Exercise" })
  await expect(group).toBeVisible()

  for (const label of ["Squat", "Deadlift", "Bicep Curl", "Bench Press", "Overhead Press", "Push-Up"]) {
    await expect(group.getByRole("radio", { name: label })).toHaveCount(1)
  }
})

test("selecting an exercise updates the collapsed bar", async ({ page }) => {
  await page.goto("/")

  await page.getByTestId("exercise-change-btn").click()
  const group = page.getByRole("radiogroup", { name: "Exercise" })
  await expect(group.getByRole("radio", { name: "Squat" })).toHaveAttribute("aria-checked", "true")

  await group.getByRole("radio", { name: "Deadlift" }).click()
  // Sheet closes; the collapsed bar now shows the new selection.
  await expect(page.getByRole("radiogroup", { name: "Exercise" })).toBeHidden()
  await expect(page.getByText("Deadlift")).toBeVisible()
})

test("the search box filters the grid", async ({ page }) => {
  await page.goto("/")

  await page.getByTestId("exercise-change-btn").click()
  await page.getByTestId("exercise-search").fill("press")
  const group = page.getByRole("radiogroup", { name: "Exercise" })
  await expect(group.getByRole("radio", { name: "Overhead Press" })).toBeVisible()
  await expect(group.getByRole("radio", { name: "Squat" })).toHaveCount(0)
})
