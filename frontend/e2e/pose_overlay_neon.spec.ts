import { expect, test } from "@playwright/test"

/**
 * UI-11 neon overlay visual gate (§6). Mounts PoseOverlayNeon via the
 * QA-only overlay-preview.html harness (no camera/WebSocket/backend), driven
 * by the fixed `good`/`fault` fixtures, and snapshots the canvas for both
 * states. Entirely independent of the legacy pose_overlay.spec.ts, which
 * must stay green and untouched.
 */

for (const stateName of ["good", "fault"] as const) {
  test(`neon overlay renders the ${stateName} fixture`, async ({ page }) => {
    await page.goto(`/overlay-preview.html?state=${stateName}`)

    const stage = page.getByTestId("overlay-preview-stage")
    await expect(stage).toHaveAttribute("data-state", stateName)

    const canvas = page.getByTestId("pose-overlay-neon")
    await expect(canvas).toBeAttached()

    // The draw effect should have painted non-transparent pixels (bones/nodes/arcs).
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const c = document.querySelector(
            '[data-testid="pose-overlay-neon"]',
          ) as HTMLCanvasElement | null
          if (!c || c.width === 0 || c.height === 0) return 0
          const ctx = c.getContext("2d")
          if (!ctx) return 0
          const data = ctx.getImageData(0, 0, c.width, c.height).data
          let painted = 0
          for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++
          return painted
        }),
      )
      .toBeGreaterThan(0)

    await canvas.screenshot({ path: `test-results/pose_overlay_neon_${stateName}.png` })
  })
}
