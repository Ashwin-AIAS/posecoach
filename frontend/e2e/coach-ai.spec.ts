import { expect, test } from "@playwright/test"

/**
 * P35 — "Coach AI" discoverability E2E.
 *
 * The AI coach used to be reachable only through: live session → floating
 * bubble → tray → Chat sub-tab. These specs pin the two new one-tap entry
 * points and the layout of the (now three-button) floating trigger cluster.
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
  await page.route("**/api/v1/history/recommendation**", (route) =>
    route.fulfill({ status: 204, contentType: "application/json", body: "" }),
  )
})

test("Home reaches Coach AI in one tap, without a camera session", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto("/")

  const card = page.getByTestId("coach-ai-btn")
  await expect(card).toBeInViewport()
  await expect(card).toContainText("Coach AI")
  await expect(card).toContainText("Ask about form, sets, nutrition")

  await card.click()

  // Chat is immediately usable — no nested toggle, no camera stage mounted.
  await expect(page.getByTestId("coach-ai-sheet")).toBeVisible()
  await expect(page.getByTestId("chat-input")).toBeVisible()
  await expect(page.getByTestId("camera-stage")).toHaveCount(0)
  // Text-only path: nothing to snapshot, so no frame button is offered.
  await expect(page.locator('[data-testid="chat-frame-btn"]:visible')).toHaveCount(0)

  await page.getByTestId("coach-ai-close").click()
  await expect(page.getByTestId("coach-ai-sheet")).toHaveCount(0)
})

test("live view Coach AI trigger opens the tray straight on an expanded Chat", async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto("/")
  await page.getByTestId("start-workout-btn").click()

  const trigger = page.getByTestId("coach-ai-trigger")
  await expect(trigger).toBeVisible()
  await expect(trigger).toHaveAttribute("aria-label", "Open Coach AI")
  await trigger.click()

  await expect(page.getByRole("tab", { name: "Chat" })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await expect(page.locator('[data-testid="chat-input"]:visible')).toHaveCount(1)
})

for (const { width, height, label } of [
  { width: 375, height: 667, label: "iPhone SE" },
  { width: 393, height: 852, label: "iPhone 15" },
]) {
  test(`floating trigger cluster stays clear of the score ring on ${label}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height })
    await page.goto("/")
    await page.getByTestId("start-workout-btn").click()

    const stage = await page.getByTestId("camera-stage").boundingBox()
    if (!stage) throw new Error("missing layout boxes")

    // The ScoreRing chip (CameraHud) only mounts once the camera is live, which
    // headless Chromium has no device for — so assert against its fixed
    // geometry instead: top-3 (12px) + p-1.5 (6px) + a 128px ring + p-1.5.
    const SCORE_CHIP_BOTTOM_PX = 12 + 6 + 128 + 6

    for (const id of ["tray-trigger", "reference-trigger", "coach-ai-trigger"]) {
      const box = await page.getByTestId(id).boundingBox()
      if (!box) throw new Error(`missing box for ${id}`)
      // Below the ScoreRing chip, and fully inside the camera stage.
      expect(box.y - stage.y).toBeGreaterThanOrEqual(SCORE_CHIP_BOTTOM_PX)
      expect(box.y + box.height).toBeLessThanOrEqual(stage.y + stage.height)
      // WCAG 2.5.5 AA tap target.
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
      await expect(page.getByTestId(id)).toBeInViewport()
    }

    // No two triggers overlap each other.
    const boxes = await Promise.all(
      ["tray-trigger", "reference-trigger", "coach-ai-trigger"].map((id) =>
        page.getByTestId(id).boundingBox(),
      ),
    )
    for (let i = 1; i < boxes.length; i++) {
      const prev = boxes[i - 1]
      const cur = boxes[i]
      if (!prev || !cur) throw new Error("missing box")
      expect(cur.y).toBeGreaterThanOrEqual(prev.y + prev.height)
    }
  })
}
