import { expect, test } from "@playwright/test"

/**
 * Auth flow E2E — sign in via the AuthModal with mocked backend.
 *
 * The PoseCoach backend is NOT required for this test. All `/api/v1/auth/*`
 * endpoints are intercepted via `page.route()`.
 */

test.beforeEach(async ({ page }) => {
  // Grant camera permission up-front so useCamera doesn't surface an error
  await page.context().grantPermissions(["camera"])

  // /auth/me starts as 401 (anonymous), then switches to authenticated user
  // once login succeeds. We toggle the response via a closure variable.
  let authenticated = false
  const user = {
    id: "user-1",
    email: "test@example.com",
    created_at: "2026-05-21T00:00:00Z",
  }

  await page.route("**/api/v1/auth/me", async (route) => {
    if (!authenticated) {
      await route.fulfill({ status: 401, contentType: "application/json", body: "{}" })
      return
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) })
  })

  await page.route("**/api/v1/auth/login", async (route) => {
    authenticated = true
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) })
  })

  await page.route("**/api/v1/auth/logout", async (route) => {
    authenticated = false
    await route.fulfill({ status: 204, body: "" })
  })

  // Silence the history endpoint so the panel doesn't error in the background
  await page.route("**/api/v1/history**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  })
})

test("anonymous user sees Sign in button", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByTestId("signin-btn")).toBeVisible()
})

test("login flow → authenticated UI", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("signin-btn").click()

  const modal = page.getByTestId("auth-modal")
  await expect(modal).toBeVisible()

  await modal.getByLabel("Email").fill("test@example.com")
  await modal.getByLabel("Password").fill("hunter2")
  await modal.getByRole("button", { name: "Sign in" }).click()

  // After login, the user email + logout button replace the Sign in button
  await expect(page.getByTestId("user-email")).toHaveText("test@example.com")
  await expect(page.getByTestId("logout-btn")).toBeVisible()
  await expect(page.getByTestId("signin-btn")).not.toBeVisible()
})
