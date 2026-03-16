import { test, expect } from "@playwright/test"

/**
 * Visual audit for the restyled dashboard pages.
 * Takes screenshots of Tasks, Cycles, and Runs pages for manual review.
 * Run with: bunx playwright test --project chromium
 */

test.describe("Visual Audit - Dashboard Pages", () => {
  test("Tasks page - kanban view", async ({ page }) => {
    // Force dark mode via URL or wait for app to load
    await page.goto("/?view=kanban")
    // Wait for the kanban columns to actually render
    await page.waitForSelector("[data-testid^='kanban-column-']", { timeout: 10000 })
    await page.waitForTimeout(500)
    await page.screenshot({
      path: "e2e/screenshots/tasks-kanban.png",
      fullPage: false,
    })
  })

  test("Tasks page - list view", async ({ page }) => {
    await page.goto("/?view=list")
    // Wait for task cards or the empty state to appear
    await page.waitForSelector("[role='button'], [class*='EmptyState']", { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(500)
    await page.screenshot({
      path: "e2e/screenshots/tasks-list.png",
      fullPage: false,
    })
  })

  test("Cycles page", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    // Click cycles tab
    const cyclesTab = page.locator("button").filter({ hasText: /^Cycles$/ })
    await cyclesTab.click()
    await page.waitForTimeout(800)
    await page.screenshot({
      path: "e2e/screenshots/cycles.png",
      fullPage: false,
    })
  })

  test("Specs page", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    const specsTab = page.locator("button").filter({ hasText: /^Specs$/ })
    await specsTab.click()
    await page.waitForTimeout(800)
    await page.screenshot({
      path: "e2e/screenshots/specs.png",
      fullPage: false,
    })
  })

  test("Runs page", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    // Click runs tab
    const runsTab = page.locator("button").filter({ hasText: /^Runs$/ })
    await runsTab.click()
    await page.waitForTimeout(800)
    await page.screenshot({
      path: "e2e/screenshots/runs.png",
      fullPage: false,
    })
  })
})
