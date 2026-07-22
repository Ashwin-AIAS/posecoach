import { expect, test } from "@playwright/test"

/**
 * Account-recovery E2E (P33) — request → reset → sign-in happy path.
 *
 * The PoseCoach backend is NOT required. All `/api/v1/auth/*` endpoints are
 * intercepted with `page.route()`; the recovery pages are standalone routes
 * (`/forgot-password`, `/reset-password?token=…`) served by the SPA fallback.
 */

test.beforeEach(async ({ page }) => {
  await page.context().grantPermissions(["camera"])

  let authenticated = false
  const user = { id: "user-1", email: "test@example.com", created_at: "2026-07-22T00:00:00Z" }

  await page.route("**/api/v1/auth/me", async (route) => {
    await route.fulfill(
      authenticated
        ? { status: 200, contentType: "application/json", body: JSON.stringify(user) }
        : { status: 401, contentType: "application/json", body: "{}" },
    )
  })
  await page.route("**/api/v1/auth/forgot-password", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: "If that email is registered, we've sent a reset link." }),
    })
  })
  await page.route("**/api/v1/auth/reset-password", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: "Your password has been updated." }),
    })
  })
  await page.route("**/api/v1/auth/login", async (route) => {
    authenticated = true
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) })
  })
  await page.route("**/api/v1/history**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  })
})

test("login modal exposes a forgot-password link", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("signin-btn").click()
  await expect(page.getByTestId("auth-modal")).toBeVisible()
  await expect(page.getByTestId("forgot-password-link")).toHaveAttribute("href", "/forgot-password")
  await expect(page.getByTestId("forgot-username-link")).toBeVisible()
})

test("forgot-password page submits and shows the generic confirmation", async ({ page }) => {
  await page.goto("/forgot-password")
  await page.getByLabel("Email").fill("test@example.com")
  await page.getByRole("button", { name: "Send reset link" }).click()
  await expect(page.getByTestId("forgot-confirmation")).toBeVisible()
  await expect(page.getByTestId("forgot-confirmation")).toContainText(/if that email is registered/i)
})

test("full flow: reset link → set new password → back to sign in", async ({ page }) => {
  // The user follows the emailed link (token in the query string).
  await page.goto("/reset-password?token=demo-reset-token")
  await page.getByLabel("New password", { exact: true }).fill("brandnewpass9")
  await page.getByLabel("Confirm new password").fill("brandnewpass9")
  await page.getByRole("button", { name: "Update password" }).click()

  await expect(page.getByTestId("reset-success")).toBeVisible()

  // "Go to sign in" returns to the app, where the user can now log in.
  await page.getByTestId("reset-go-signin").click()
  await expect(page.getByTestId("signin-btn")).toBeVisible()
  await page.getByTestId("signin-btn").click()
  await page.getByTestId("auth-modal").getByLabel("Email").fill("test@example.com")
  await page.getByTestId("auth-modal").getByLabel("Password").fill("brandnewpass9")
  await page.getByTestId("auth-modal").getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByTestId("user-email")).toHaveText("test@example.com")
})

test("reset-password with no token shows the invalid-link message", async ({ page }) => {
  await page.goto("/reset-password")
  await expect(page.getByTestId("reset-invalid")).toBeVisible()
})
