import { expect, test } from "@playwright/test"

/**
 * P28 — the Calories tab lands on today's diary, and the add-food happy path
 * (manual entry, so no camera is needed) puts a row in the right meal with
 * updated totals. All backend calls are mocked via page.route.
 */

/** Local YYYY-MM-DD — must match the app's todayISO() (same machine + TZ). */
function todayISO(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

const MANUAL_FOOD = {
  id: "f-oats",
  barcode: null,
  name: "Oats",
  brand: null,
  serving_size_g: null,
  serving_label: null,
  kcal_100g: 380,
  protein_100g: 13,
  carbs_100g: 68,
  fat_100g: 7,
  image_url: null,
  source: "manual",
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  )

  // Stateful diary: empty until the POST lands, then one snack entry today.
  let logged = false
  const entry = {
    id: "e1",
    logged_date: todayISO(),
    meal: "snack",
    amount_g: 100,
    kcal: 380,
    protein_g: 13,
    carbs_g: 68,
    fat_g: 7,
    food: MANUAL_FOOD,
  }
  await page.route("**/api/v1/nutrition/log**", (route) => {
    if (route.request().method() === "POST") {
      logged = true
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(entry) })
    }
    const date = new URL(route.request().url()).searchParams.get("date") ?? todayISO()
    const entries = logged && date === todayISO() ? [entry] : []
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        log_date: date,
        entries,
        totals: {
          kcal: entries.reduce((a, e) => a + e.kcal, 0),
          protein_g: entries.reduce((a, e) => a + e.protein_g, 0),
          carbs_g: entries.reduce((a, e) => a + e.carbs_g, 0),
          fat_g: entries.reduce((a, e) => a + e.fat_g, 0),
        },
      }),
    })
  })
  await page.route("**/api/v1/nutrition/foods", (route) =>
    route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(MANUAL_FOOD) }),
  )
})

test("the Calories tab lands on today's diary with the tab bar visible", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto("/")

  await page.getByTestId("tab-calories").click()

  await expect(page.getByTestId("day-nav")).toBeVisible()
  await expect(page.getByTestId("day-label")).toHaveText("Today")
  await expect(page.getByTestId("daily-totals")).toBeVisible()
  await expect(page.getByTestId("day-next")).toBeDisabled()
  // The diary is a normal tab screen — the bar stays.
  await expect(page.getByTestId("tab-bar")).toBeVisible()
})

test("add food (manual) → the row lands in its meal and totals update", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto("/")
  await page.getByTestId("tab-calories").click()

  // Empty day → Add food → type it in.
  await page.getByTestId("diary-empty-add").click()
  await page.getByTestId("manual-entry-btn").click()
  await page.getByTestId("mf-name").fill("Oats")
  await page.getByTestId("mf-kcal").fill("380")
  await page.getByTestId("mf-save").click()

  // Straight to the macro card + add sheet; log 100 g as a snack.
  await expect(page.getByTestId("add-to-diary-sheet")).toBeVisible()
  await page.getByTestId("atd-submit").click()

  // Back on the diary: the row is in Snack and the totals reflect it.
  await expect(page.getByTestId("meal-section-snack")).toBeVisible()
  await expect(page.getByTestId("entry-row-e1")).toBeVisible()
  await expect(page.getByTestId("totals-kcal")).toHaveText("380")
})
