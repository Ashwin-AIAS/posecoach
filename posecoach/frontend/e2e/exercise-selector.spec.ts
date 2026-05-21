import { expect, test } from "@playwright/test"

/**
 * Exercise selector E2E — verifies the user can switch between the 7
 * supported exercises (mirrors SUPPORTED_EXERCISES in app/analysis/form_scorer.py).
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

test("exercise radiogroup shows all 7 supported exercises", async ({ page }) => {
  await page.goto("/")

  const group = page.getByRole("radiogroup", { name: "Exercise" })
  await expect(group).toBeVisible()

  for (const label of ["Squat", "Deadlift", "Curl", "Bench", "OHP", "Lunge", "Plank"]) {
    await expect(group.getByRole("radio", { name: label })).toHaveCount(1)
  }
})

test("clicking an exercise updates aria-checked", async ({ page }) => {
  await page.goto("/")
  const group = page.getByRole("radiogroup", { name: "Exercise" })

  // Squat is the default
  await expect(group.getByRole("radio", { name: "Squat" })).toHaveAttribute("aria-checked", "true")

  await group.getByRole("radio", { name: "Deadlift" }).click()
  await expect(group.getByRole("radio", { name: "Deadlift" })).toHaveAttribute("aria-checked", "true")
  await expect(group.getByRole("radio", { name: "Squat" })).toHaveAttribute("aria-checked", "false")

  await group.getByRole("radio", { name: "Plank" }).click()
  await expect(group.getByRole("radio", { name: "Plank" })).toHaveAttribute("aria-checked", "true")
})
