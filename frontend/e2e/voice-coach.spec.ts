import { expect, test } from "@playwright/test"

/**
 * P29 S6 — BootCard persona picker/unmute gate and CueToast visual twin.
 * Mounted via the QA-only voice-preview.html harness (no camera/WebSocket/
 * backend involved), mirroring pose_overlay_neon.spec.ts's pattern for
 * PoseOverlayNeon.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/voice-preview.html")
})

test("boot card shows all three personas with the default selected", async ({ page }) => {
  const card = page.getByTestId("voice-boot-card")
  await expect(card).toBeVisible()

  await expect(page.getByTestId("voice-persona-atlas")).toHaveAttribute("aria-checked", "true")
  await expect(page.getByTestId("voice-persona-forge")).toHaveAttribute("aria-checked", "false")
  await expect(page.getByTestId("voice-persona-vector")).toHaveAttribute("aria-checked", "false")
})

test("picking a persona chip updates the selection", async ({ page }) => {
  await page.getByTestId("voice-persona-forge").click()

  await expect(page.getByTestId("voice-persona-forge")).toHaveAttribute("aria-checked", "true")
  await expect(page.getByTestId("voice-persona-atlas")).toHaveAttribute("aria-checked", "false")
})

test("unmute closes the boot card", async ({ page }) => {
  await page.getByTestId("voice-boot-unmute").click()
  await expect(page.getByTestId("voice-boot-card")).toHaveCount(0)
})

test("unmute is disabled until the manifest is ready", async ({ page }) => {
  await page.getByTestId("preview-toggle-ready").click() // ready -> false
  await expect(page.getByTestId("voice-boot-unmute")).toBeDisabled()

  await page.getByTestId("preview-toggle-ready").click() // ready -> true
  await expect(page.getByTestId("voice-boot-unmute")).toBeEnabled()
})

test("stay muted dismisses the card without requiring a persona change", async ({ page }) => {
  await page.getByTestId("voice-boot-stay-muted").click()
  await expect(page.getByTestId("voice-boot-card")).toHaveCount(0)
  await expect(page.getByTestId("preview-reopen-boot")).toBeVisible()
})

test("firing a cue shows its CueToast twin, then it auto-dismisses", async ({ page }) => {
  await page.getByTestId("voice-boot-unmute").click()

  await page.getByTestId("preview-fire-cue").click()
  const toast = page.getByTestId("cue-toast")
  await expect(toast).toBeVisible()
  await expect(toast).toHaveText(/Squat deeper for full range/)
  await expect(toast).toHaveAttribute("data-severity", "high")

  // The preview harness uses a 900ms visible window — well under the
  // production 3200ms default — so the test stays fast without racing it.
  await expect(toast).toHaveCount(0, { timeout: 3000 })
})

test("a new cue replaces the one currently showing instead of stacking", async ({ page }) => {
  await page.getByTestId("voice-boot-unmute").click()

  await page.getByTestId("preview-fire-cue").click()
  await expect(page.getByTestId("cue-toast")).toHaveText(/Squat deeper for full range/)

  await page.getByTestId("preview-fire-cue").click()
  // Exactly one toast node — never two stacked.
  await expect(page.getByTestId("cue-toast")).toHaveCount(1)
  await expect(page.getByTestId("cue-toast")).toHaveText(/Own the bottom/)
})

test("motion is static under prefers-reduced-motion but content still appears", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/voice-preview.html")

  await expect(page.getByTestId("voice-boot-card")).toBeVisible()
  await page.getByTestId("voice-boot-unmute").click()
  await page.getByTestId("preview-fire-cue").click()
  await expect(page.getByTestId("cue-toast")).toBeVisible()
})
