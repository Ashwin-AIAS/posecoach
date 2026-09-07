import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

/**
 * P29 S8 — the live Coach view actually mounting BootCard/CueToast and
 * wiring the cue-arbitration bridge to the real WS frame stream. Backend is
 * fully mocked (auth/history/voice manifest/voice events + a fake
 * inference WebSocket via `page.routeWebSocket`, mirroring
 * `pose_overlay.spec.ts`'s established pattern) — no FastAPI, Postgres,
 * model, or camera required.
 */

const MANIFEST_WITH_SQUAT_FAULT = {
  version: 2,
  clips: {},
  faults: { "squat::Squat deeper for full range": "squat.knee_angle.high" },
}

async function mockCommonRoutes(page: Page, manifest: object = MANIFEST_WITH_SQUAT_FAULT): Promise<void> {
  await page.context().grantPermissions(["camera"])
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  )
  await page.route("**/api/v1/history**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  )
  await page.route("**/api/v1/voice/manifest", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(manifest) }),
  )
  await page.route("**/api/v1/voice/events", (route) => route.fulfill({ status: 204 }))
}

// A full 17-point fixture (mirrors pose_overlay.spec.ts's) so the frozen
// overlay/HUD rendering never trips on a malformed frame — this spec only
// cares about the voice wiring, not overlay correctness.
const KEYPOINTS = [
  [0.5, 0.1], [0.47, 0.09], [0.53, 0.09], [0.45, 0.1], [0.55, 0.1],
  [0.42, 0.22], [0.58, 0.22], [0.4, 0.35], [0.6, 0.35], [0.39, 0.47],
  [0.61, 0.47], [0.45, 0.5], [0.55, 0.5], [0.44, 0.7], [0.56, 0.7],
  [0.45, 0.9], [0.55, 0.9],
]
const CONFIDENCE = new Array(17).fill(0.9)

// Baseline frame (no cue yet) then a rep-boundary frame carrying a squat
// knee-flare cue with a 40-point deficit at the worst joint (severity "high").
const BASELINE_FRAME = {
  keypoints: KEYPOINTS,
  confidence: CONFIDENCE,
  score: 90,
  cues: [] as string[],
  latency_ms: 20,
  reps: 1,
}

const BOUNDARY_FRAME = {
  keypoints: KEYPOINTS,
  confidence: CONFIDENCE,
  score: 60,
  cues: ["Squat deeper for full range"],
  latency_ms: 20,
  reps: 3,
  worst_joint: "left_knee_angle",
  joint_scores: { left_knee_angle: 60, right_knee_angle: 92 },
}

test("boot card mounts on the live Coach view and lets the user pick a persona", async ({ page }) => {
  await mockCommonRoutes(page)
  await page.routeWebSocket(/\/ws\/inference/, () => {
    // No frames needed for this test — just proves the mount + persona pick.
  })

  await page.goto("/?voiceBoot=1")
  await page.getByTestId("start-workout-btn").click()

  await expect(page.getByTestId("voice-boot-card")).toBeVisible()
  await expect(page.getByTestId("voice-persona-atlas")).toHaveAttribute("aria-checked", "true")

  await page.getByTestId("voice-persona-forge").click()
  await expect(page.getByTestId("voice-persona-forge")).toHaveAttribute("aria-checked", "true")

  await page.getByTestId("voice-boot-stay-muted").click()
  await expect(page.getByTestId("voice-boot-card")).toHaveCount(0)
})

test("a rep boundary resolves the WS cue to a fault id and shows its CueToast twin", async ({ page }) => {
  await mockCommonRoutes(page)
  await page.routeWebSocket(/\/ws\/inference/, async (ws) => {
    // A real-world delay between frames (~66ms at 15fps) so React commits
    // the baseline frame on its own — sent back-to-back with no gap, React
    // 18 can batch both `setResult()` calls into a single render and the
    // bridge would only ever see the final frame, never the transition.
    ws.send(JSON.stringify(BASELINE_FRAME))
    await new Promise((resolve) => setTimeout(resolve, 300))
    ws.send(JSON.stringify(BOUNDARY_FRAME))
  })

  await page.goto("/?voiceBoot=1")
  await page.getByTestId("start-workout-btn").click()

  // Dismiss the boot card out of the way (CueToast fires regardless of mute
  // state — spec §4 "a muted user loses nothing" — but the card's own
  // full-screen backdrop would otherwise sit visually on top of it).
  await page.getByTestId("voice-boot-unmute").click()

  const toast = page.getByTestId("cue-toast")
  await expect(toast).toBeVisible()
  await expect(toast).toHaveText(/Squat deeper for full range/)
  await expect(toast).toHaveAttribute("data-severity", "high")
})

test("an out-of-scope exercise's cue is reported as a distinct fault_lookup_miss, not fired", async ({
  page,
}) => {
  // Faults section deliberately empty -- every cue text misses the lookup.
  await mockCommonRoutes(page, { version: 2, clips: {}, faults: {} })
  await page.routeWebSocket(/\/ws\/inference/, async (ws) => {
    ws.send(JSON.stringify(BASELINE_FRAME))
    await new Promise((resolve) => setTimeout(resolve, 300))
    ws.send(JSON.stringify(BOUNDARY_FRAME))
  })

  const suppressedEvents: unknown[] = []
  await page.route("**/api/v1/voice/events", async (route) => {
    const body = route.request().postDataJSON() as { events: { event: string; reason?: string }[] }
    suppressedEvents.push(...body.events.filter((e) => e.event === "suppressed"))
    await route.fulfill({ status: 204 })
  })

  await page.goto("/?voiceBoot=1")
  await page.getByTestId("start-workout-btn").click()
  await page.getByTestId("voice-boot-unmute").click()

  // No lookup entry -> no toast, ever (poll long enough to be confident).
  await expect(page.getByTestId("cue-toast")).toHaveCount(0)
  await expect
    .poll(() => suppressedEvents.some((e) => (e as { reason?: string }).reason === "fault_lookup_miss"))
    .toBe(true)
})
