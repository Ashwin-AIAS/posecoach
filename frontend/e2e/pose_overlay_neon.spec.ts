import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

/**
 * UI-11 neon overlay visual gate (§6). Mounts PoseOverlayNeon via the
 * QA-only overlay-preview.html harness (no camera/WebSocket/backend), driven
 * by the fixed `good`/`fault` fixtures, and snapshots the canvas for both
 * states plus the reduced-motion path. Entirely independent of the legacy
 * pose_overlay.spec.ts, which must stay green and untouched.
 */

const STATUS_DOT = { x: 19, y: 36 } // matches drawStatusLine's dot position
const GOOD_RGB = [0x2b, 0xf5, 0xb0] as const
const ERROR_RGB = [0xff, 0x4d, 0x6d] as const
const CUE_BY_STATE = {
  good: "Nice depth — keep your chest up",
  fault: "Squat deeper for full range",
} as const

async function paintedPixelCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid="pose-overlay-neon"]') as HTMLCanvasElement | null
    if (!c || c.width === 0 || c.height === 0) return 0
    const ctx = c.getContext("2d")
    if (!ctx) return 0
    const data = ctx.getImageData(0, 0, c.width, c.height).data
    let painted = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++
    return painted
  })
}

async function samplePixel(page: Page, x: number, y: number): Promise<readonly [number, number, number]> {
  return page.evaluate(
    ({ x, y }) => {
      const c = document.querySelector('[data-testid="pose-overlay-neon"]') as HTMLCanvasElement
      const ctx = c.getContext("2d")
      if (!ctx) return [0, 0, 0] as const
      const dpr = window.devicePixelRatio || 1
      const data = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data
      return [data[0], data[1], data[2]] as const
    },
    { x, y },
  )
}

function channelDistance(a: readonly number[], b: readonly number[]): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))
}

for (const stateName of ["good", "fault"] as const) {
  test(`neon overlay renders the ${stateName} fixture`, async ({ page }) => {
    await page.goto(`/overlay-preview.html?state=${stateName}`)

    const stage = page.getByTestId("overlay-preview-stage")
    await expect(stage).toHaveAttribute("data-state", stateName)

    const canvas = page.getByTestId("pose-overlay-neon")
    await expect(canvas).toBeAttached()

    // The draw loop should have painted non-transparent pixels (bones/nodes/arcs/HUD).
    await expect.poll(() => paintedPixelCount(page)).toBeGreaterThan(0)

    // Cue chip text — asserted via the canvas's aria-label (screen-reader parity, §4.6),
    // since the chip itself is drawn to canvas rather than as DOM text.
    await expect(canvas).toHaveAttribute("aria-label", CUE_BY_STATE[stateName])

    // Status dot color: mint for good, rose for a fault/error state.
    const expected = stateName === "good" ? GOOD_RGB : ERROR_RGB
    const other = stateName === "good" ? ERROR_RGB : GOOD_RGB
    const pixel = await samplePixel(page, STATUS_DOT.x, STATUS_DOT.y)
    expect(channelDistance(pixel, expected)).toBeLessThan(channelDistance(pixel, other))
    expect(channelDistance(pixel, expected)).toBeLessThan(40)

    await canvas.screenshot({ path: `test-results/pose_overlay_neon_${stateName}.png` })
  })
}

test("idle state dims the skeleton and hides the cue chip", async ({ page }) => {
  await page.goto("/overlay-preview.html?state=idle")

  const canvas = page.getByTestId("pose-overlay-neon")
  await expect(canvas).toHaveAttribute("aria-label", "Searching for a person")
  // Grid/vignette/HUD chrome still paint even with no keypoints to draw.
  await expect.poll(() => paintedPixelCount(page)).toBeGreaterThan(0)
})

test("motion is static under prefers-reduced-motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/overlay-preview.html?state=good")

  const canvas = page.getByTestId("pose-overlay-neon")
  await expect.poll(() => paintedPixelCount(page)).toBeGreaterThan(0)

  const before = await canvas.screenshot()
  await page.waitForTimeout(900) // longer than one scan/pulse period would move something
  const after = await canvas.screenshot()
  expect(before.equals(after)).toBe(true)
})

test("motion animates when reduced-motion is not requested", async ({ page }) => {
  await page.goto("/overlay-preview.html?state=good")

  const canvas = page.getByTestId("pose-overlay-neon")
  await expect.poll(() => paintedPixelCount(page)).toBeGreaterThan(0)

  const before = await canvas.screenshot()
  await page.waitForTimeout(1200)
  const after = await canvas.screenshot()
  expect(before.equals(after)).toBe(false)
})
