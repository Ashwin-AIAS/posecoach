import { expect, test } from "@playwright/test"

/**
 * Pose overlay E2E — drives the data-driven overlay with a fixture frame over a
 * mocked WebSocket and verifies the canvas actually paints (all rendering passes
 * run). Rendering correctness is checked visually via the captured screenshot.
 *
 * Backend is fully mocked — no FastAPI / Postgres / model / camera required.
 */

// A mid-squat pose (score < 70 so the worst-joint spotlight is active; rep_state
// "down" drives breathing; reps=1 fires one particle burst).
const FIXTURE = {
  keypoints: [
    [0.5, 0.1],
    [0.47, 0.09],
    [0.53, 0.09],
    [0.45, 0.1],
    [0.55, 0.1],
    [0.42, 0.22],
    [0.58, 0.22],
    [0.4, 0.35],
    [0.6, 0.35],
    [0.39, 0.47],
    [0.61, 0.47],
    [0.45, 0.5],
    [0.55, 0.5],
    [0.44, 0.7],
    [0.56, 0.7],
    [0.45, 0.9],
    [0.55, 0.9],
  ],
  confidence: new Array(17).fill(0.9),
  score: 62,
  cues: ["Squat deeper for full range"],
  latency_ms: 45,
  reps: 1,
  joint_scores: {
    left_knee_angle: 55,
    right_knee_angle: 60,
    left_hip_angle: 70,
    right_hip_angle: 65,
  },
  worst_joint: "left_knee_angle",
  rep_state: "down",
  measured_angles: {
    left_knee_angle: 92,
    right_knee_angle: 95,
    left_hip_angle: 88,
    right_hip_angle: 90,
  },
}

test.beforeEach(async ({ page }) => {
  await page.context().grantPermissions(["camera"])
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  )
  await page.route("**/api/v1/history**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  )

  // Mock the inference WebSocket: push a few jittered fixture frames so the
  // trail, velocity, and particle effects all have data to render.
  await page.routeWebSocket(/\/ws\/inference/, (ws) => {
    for (let i = 0; i < 6; i++) {
      const jittered = {
        ...FIXTURE,
        keypoints: FIXTURE.keypoints.map(([x, y]) => [x + i * 0.002, y + i * 0.001]),
      }
      ws.send(JSON.stringify(jittered))
    }
  })
})

test("overlay canvas renders the data-driven skeleton", async ({ page }) => {
  await page.goto("/")

  const canvas = page.getByTestId("pose-overlay")
  await expect(canvas).toBeAttached()

  // The rAF loop should paint non-transparent pixels from the fixture frame.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const c = document.querySelector(
            '[data-testid="pose-overlay"]',
          ) as HTMLCanvasElement | null
          if (!c || c.width === 0 || c.height === 0) return 0
          const ctx = c.getContext("2d")
          if (!ctx) return 0
          const data = ctx.getImageData(0, 0, c.width, c.height).data
          let painted = 0
          for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++
          return painted
        }),
      { timeout: 6000 },
    )
    .toBeGreaterThan(0)

  // Capture for manual visual QA of the 10 effects.
  await canvas.screenshot({ path: "test-results/pose_overlay.png" })
})
