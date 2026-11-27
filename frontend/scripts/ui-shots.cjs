/**
 * UI screenshot harness for the P36 premium-elevation lanes.
 *
 * Captures every main screen at phone (390x844 @2x) and desktop (1440x900)
 * against a running Vite dev server, with all /api/v1 calls mocked and a fake
 * camera — no backend, DB, or model needed.
 *
 * Usage (from frontend/, with `npm run dev -- --port $PORT --strictPort` running):
 *   PORT=5181 OUT=../.shots/lane-a node scripts/ui-shots.cjs
 *
 * Each lane MUST use its own PORT (A=5181, B=5182, C=5183). Never 5173 —
 * that port belongs to the Playwright e2e server.
 */
const path = require("node:path")
const fs = require("node:fs")
const { chromium } = require("@playwright/test")

const PORT = process.env.PORT || "5181"
const BASE = `http://localhost:${PORT}`
const OUT = path.resolve(process.env.OUT || "../.shots")
fs.mkdirSync(OUT, { recursive: true })

const now = Date.now()
const DAY = 86400000
const sessions = Array.from({ length: 8 }, (_, i) => ({
  id: "s" + i,
  exercise: ["squat", "deadlift", "curl", "bench"][i % 4],
  session_type: "exercise",
  rep_count: 8 + i,
  avg_form_score: 62 + ((i * 7) % 30),
  started_at: new Date(now - i * DAY).toISOString(),
  ended_at: new Date(now - i * DAY + 600000).toISOString(),
}))
const today = new Date().toISOString().slice(0, 10)

async function mock(page, { authed }) {
  await page.route("**/api/v1/**", async (route) => {
    const url = route.request().url()
    const json = (b, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) })
    if (!authed && !url.includes("/voice/")) return json({ detail: "unauthorized" }, 401)
    if (url.includes("/auth/me"))
      return json({ id: "u1", email: "alex@example.com", created_at: new Date().toISOString() })
    if (url.includes("/history/recommendation"))
      return json({ exercise: "squat", rep_target_delta: 1, focus_joint: "knee", message: "Add 1 rep; keep knees out" })
    if (url.includes("/history/sessions")) return json(sessions)
    if (url.includes("/nutrition/goal"))
      return json({ kcal_target: 2400, protein_target_g: 180, carbs_target_g: 250, fat_target_g: 70, updated_at: null })
    if (url.includes("/nutrition/log"))
      return json({ log_date: today, entries: [], totals: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 } })
    if (url.includes("/workouts/routines")) return json([])
    if (url.includes("/workouts/workouts")) return json([])
    if (url.includes("/workouts/exercises")) return json({ items: [], total: 0 })
    return json({}, 404)
  })
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name + ".png") })
  console.log("saved", name)
}

;(async () => {
  const browser = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  })
  const viewports = [
    ["phone", { width: 390, height: 844 }, 2],
    ["desktop", { width: 1440, height: 900 }, 1],
  ]
  for (const authed of [true, false]) {
    for (const [vpName, viewport, dpr] of viewports) {
      const tag = `${vpName}-${authed ? "authed" : "anon"}`
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, permissions: ["camera", "microphone"] })
      const page = await ctx.newPage()
      await mock(page, { authed })
      await page.goto(BASE + "/?voiceBoot=0&onboarding=0")
      await page.waitForTimeout(2000)
      await shot(page, `${tag}-01-home`)
      for (const t of ["workouts", "calories", "settings"]) {
        const tab = page.locator(`[data-testid=tab-${t}]`)
        if (await tab.count()) {
          await tab.click()
          await page.waitForTimeout(1200)
          await shot(page, `${tag}-tab-${t}`)
        }
      }
      await page.goto(BASE + "/?voiceBoot=0&onboarding=0")
      await page.waitForTimeout(1500)
      const coach = page.locator("[data-testid=coach-ai-btn]")
      if (await coach.count()) {
        await coach.click()
        await page.waitForTimeout(1200)
        await shot(page, `${tag}-02-coach-ai`)
        await page.goto(BASE + "/?voiceBoot=0&onboarding=0")
        await page.waitForTimeout(1500)
      }
      const start = page.locator("[data-testid=start-workout-btn]")
      if (await start.count()) {
        await start.click()
        await page.waitForTimeout(3500)
        await shot(page, `${tag}-03-live`)
        const finish = page.locator("[data-testid=finish-set-btn]")
        if (await finish.count()) {
          await finish.click().catch(() => {})
          await page.waitForTimeout(1500)
          await shot(page, `${tag}-04-summary`)
        }
      }
      await ctx.close()
    }
  }
  await browser.close()
})()
