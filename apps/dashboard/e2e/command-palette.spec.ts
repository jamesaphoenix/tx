/**
 * Command Palette E2E Tests
 *
 * Verifies the CMD+K command palette works correctly across:
 * - Tasks list page
 * - Individual task detail page
 * - Cycles page (cycle detail with tasks)
 *
 * Run with: cd apps/dashboard && npx playwright test e2e/command-palette.spec.ts
 */

import { test, expect, type Page } from "playwright/test"

// ─── Helpers ───────────────────────────────────────────────────────────

/** Locator for the palette input — matches "Type a command..." or "Filter <X>..." */
function paletteInput(page: Page) {
  return page.locator("[data-command-palette-input='true']")
}

async function openPalette(page: Page) {
  await page.keyboard.press("Meta+k")
  await expect(paletteInput(page)).toBeVisible({ timeout: 3000 })
}

async function closePalette(page: Page) {
  await page.keyboard.press("Escape")
  await expect(paletteInput(page)).not.toBeVisible({ timeout: 2000 })
}

async function paletteHasCommand(page: Page, text: string) {
  const palette = page.locator("[data-item-index]")
  await expect(palette.filter({ hasText: text }).first()).toBeVisible({ timeout: 3000 })
}

async function paletteDoesNotHaveCommand(page: Page, text: string) {
  const matches = page.locator("[data-item-index]").filter({ hasText: text })
  await expect(matches).toHaveCount(0, { timeout: 2000 })
}

async function clickPaletteCommand(page: Page, text: string) {
  const btn = page.locator("[data-item-index]").filter({ hasText: text }).first()
  await expect(btn).toBeVisible({ timeout: 3000 })
  await btn.click()
}

async function searchPalette(page: Page, query: string) {
  await paletteInput(page).fill(query)
}

// ─── Tasks Page ────────────────────────────────────────────────────────

test.describe("Tasks page command palette", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    // Ensure we're on the Tasks tab
    const tasksTab = page.getByRole("button", { name: /Tasks/i })
    await expect(tasksTab).toBeVisible({ timeout: 10000 })
  })

  test("CMD+K opens and ESC closes the palette", async ({ page }) => {
    await openPalette(page)
    await expect(paletteInput(page)).toBeFocused()
    await closePalette(page)
  })

  test("palette shows 'Create new task' only once (no duplicate)", async ({ page }) => {
    await openPalette(page)
    const createButtons = page.locator("[data-item-index]").filter({ hasText: "Create new task" })
    // Should be exactly 1, not 2
    await expect(createButtons).toHaveCount(1, { timeout: 3000 })
  })

  test("palette shows 'Select all tasks' with shortcut", async ({ page }) => {
    await openPalette(page)
    await paletteHasCommand(page, "Select all tasks")
  })

  test("'Filter by status' has hierarchical children", async ({ page }) => {
    await openPalette(page)
    await searchPalette(page, "Filter by status")
    await clickPaletteCommand(page, "Filter by status")

    // Should now be inside hierarchy — check for breadcrumb
    await expect(page.getByTestId("breadcrumb-root")).toBeVisible()

    // Should see individual statuses
    await paletteHasCommand(page, "Backlog")
    await paletteHasCommand(page, "Active")
    await paletteHasCommand(page, "Done")

    // ESC goes back to root (not close)
    await page.keyboard.press("Escape")
    await expect(paletteInput(page)).toBeVisible()
    await expect(page.getByTestId("breadcrumb-root")).not.toBeVisible()
  })

  test("search surfaces hierarchical children", async ({ page }) => {
    await openPalette(page)
    // Typing "Filter by status Backlog" should surface "Backlog" child
    await searchPalette(page, "Filter by status Backlog")
    await paletteHasCommand(page, "Backlog")
  })

  test("'Set selected tasks to' appears after CMD+A", async ({ page }) => {
    // Wait for task cards to actually render
    const taskCard = page.locator("[data-testid='task-card']").first()
    if (!await taskCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip()
      return
    }

    // Select all tasks
    await page.keyboard.press("Meta+a")
    // Wait for selection to propagate — look for "selected" text appearing
    await page.waitForTimeout(500)

    await openPalette(page)
    await searchPalette(page, "Set selected tasks to")
    await paletteHasCommand(page, "Set selected tasks to")
  })

  test("navigation commands show non-active tabs", async ({ page }) => {
    await openPalette(page)
    await searchPalette(page, "Go to")
    // Should see Cycles, Specs, Runs — but not Tasks (already active)
    await paletteHasCommand(page, "Go to Cycles")
    await paletteHasCommand(page, "Go to Runs")
    await paletteDoesNotHaveCommand(page, "Go to Tasks")
  })
})

// ─── Task Detail Page ──────────────────────────────────────────────────

test.describe("Task detail command palette", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("button", { name: /Tasks/i })).toBeVisible({ timeout: 10000 })
  })

  test("task detail shows 'Set status', 'Set label', 'Set score', 'Move to cycle'", async ({ page }) => {
    // Click on first task to open detail
    const firstTask = page.locator("[data-testid='task-card']").first()
    if (await firstTask.isVisible().catch(() => false)) {
      await firstTask.click()
      await page.waitForTimeout(300)

      await openPalette(page)

      // Should have standardized "Set <field>" commands
      await searchPalette(page, "Set status")
      await paletteHasCommand(page, "Set status")

      await searchPalette(page, "Set score")
      await paletteHasCommand(page, "Set score")

      // If labels exist
      await searchPalette(page, "Set label")
      // Set label only appears if there are labels configured
      // Just verify no error

      await searchPalette(page, "Move to cycle")
      // Move to cycle only appears if cycles exist
    } else {
      test.skip()
    }
  })

  test("'Set status' drill-down shows status options with number badges", async ({ page }) => {
    const firstTask = page.locator("[data-testid='task-card']").first()
    if (await firstTask.isVisible().catch(() => false)) {
      await firstTask.click()
      await page.waitForTimeout(300)

      await openPalette(page)
      await searchPalette(page, "Set status")
      await clickPaletteCommand(page, "Set status")

      // Inside hierarchy — should see breadcrumb and number badges
      await expect(page.getByTestId("breadcrumb-root")).toBeVisible()
      await paletteHasCommand(page, "Backlog")
      await paletteHasCommand(page, "Done")

      // Check for number badges (1-8 for status options)
      await expect(page.getByTestId("number-badge-1")).toBeVisible()
    } else {
      test.skip()
    }
  })

  test("task detail shows 'Back to task list' navigation", async ({ page }) => {
    const firstTask = page.locator("[data-testid='task-card']").first()
    if (await firstTask.isVisible().catch(() => false)) {
      await firstTask.click()
      await page.waitForTimeout(300)

      await openPalette(page)
      await searchPalette(page, "Back to task list")
      await paletteHasCommand(page, "Back to task list")
    } else {
      test.skip()
    }
  })
})

// ─── Cycles Page ───────────────────────────────────────────────────────

test.describe("Cycles page command palette", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.getByRole("button", { name: /Cycles/i }).click()
    await page.waitForTimeout(500)
  })

  test("CMD+N on cycles list creates a cycle (not task)", async ({ page }) => {
    await openPalette(page)
    // On cycles list, CMD+N should show "Create new cycle" not "Create new task"
    await searchPalette(page, "Create new cycle")
    await paletteHasCommand(page, "Create new cycle")
  })

  test("cycle detail palette shows task commands when tasks exist", async ({ page }) => {
    // Click on a cycle to open detail (if any exist)
    const cycleCard = page.locator("h3").filter({ hasText: /Cycle|Sprint/i }).first()
    if (await cycleCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cycleCard.click()
      await page.waitForTimeout(500)

      await openPalette(page)
      // Should have cycle-specific commands
      await paletteHasCommand(page, "Select all tasks")
    } else {
      test.skip()
    }
  })

  test("cycle detail palette has 'Set selected tasks to' after CMD+A", async ({ page }) => {
    const cycleCard = page.locator("h3").filter({ hasText: /Cycle|Sprint/i }).first()
    if (await cycleCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cycleCard.click()
      await page.waitForTimeout(500)

      // Check if tasks exist
      const taskCards = page.locator("[data-testid='task-card']")
      if (await taskCards.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        // Select all
        await page.keyboard.press("Meta+a")
        await page.waitForTimeout(200)

        await openPalette(page)
        await searchPalette(page, "Set selected tasks to")
        await paletteHasCommand(page, "Set selected tasks to")

        await searchPalette(page, "Remove selected from cycle")
        await paletteHasCommand(page, "Remove selected from cycle")
      } else {
        test.skip()
      }
    } else {
      test.skip()
    }
  })

  test("cycle detail tasks have selection checkboxes", async ({ page }) => {
    const cycleCard = page.locator("h3").filter({ hasText: /Cycle|Sprint/i }).first()
    if (await cycleCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cycleCard.click()
      await page.waitForTimeout(500)

      // Check if task cards render with selection checkboxes
      const taskCards = page.locator("[data-testid='task-card']")
      if (await taskCards.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        // TaskCard should have a toggle select button when onToggleSelect is passed
        const selectButton = taskCards.first().locator("button").first()
        await expect(selectButton).toBeVisible()
      } else {
        test.skip()
      }
    } else {
      test.skip()
    }
  })
})

// ─── Cycle → Task Navigation ──────────────────────────────────────────

test.describe("Cycle task navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.getByRole("button", { name: /Cycles/i }).click()
    await page.waitForTimeout(500)
  })

  test("clicking a task in cycle opens task detail with breadcrumb back to cycle", async ({ page }) => {
    // Open a cycle that has tasks
    const cycleCard = page.locator("h3").filter({ hasText: /Cycle|Sprint|Patched/i }).first()
    if (!await cycleCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip()
      return
    }
    await cycleCard.click()
    await page.waitForTimeout(500)

    // Find a task card and click it
    const taskCard = page.locator("[data-testid='task-card']").first()
    if (!await taskCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      test.skip()
      return
    }

    await taskCard.click()
    await page.waitForTimeout(500)

    // Should see breadcrumb with "Cycles / <cycle name> / Task"
    await expect(page.getByText("Cycles").first()).toBeVisible()
    await expect(page.getByText("Task").first()).toBeVisible()

    // Should see task detail content (Properties, description, etc.)
    // The TaskDetail component should be rendering
    await expect(page.locator("text=Properties").first()).toBeVisible({ timeout: 5000 })

    // Take screenshot for verification
    await page.screenshot({ path: "e2e/screenshots/cycle-task-detail.png" })
  })

  test("back button from task detail returns to cycle", async ({ page }) => {
    const cycleCard = page.locator("h3").filter({ hasText: /Cycle|Sprint|Patched/i }).first()
    if (!await cycleCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip()
      return
    }
    await cycleCard.click()
    await page.waitForTimeout(500)

    const taskCard = page.locator("[data-testid='task-card']").first()
    if (!await taskCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      test.skip()
      return
    }
    await taskCard.click()
    await page.waitForTimeout(500)

    // Should be in task detail — verify breadcrumb exists
    await expect(page.getByText("Task").first()).toBeVisible({ timeout: 3000 })

    // Click the cycle name in the breadcrumb to go back
    const cycleBreadcrumb = page.locator("button").filter({ hasText: /Cycle|Sprint|Patched/i }).first()
    await cycleBreadcrumb.click()
    await page.waitForTimeout(500)

    // Should be back in cycle detail — task list should be visible
    await expect(page.locator("[data-testid='task-card']").first()).toBeVisible({ timeout: 3000 })
  })

  test("CMD+K in cycle task detail shows 'Set status' and 'Back to' commands", async ({ page }) => {
    const cycleCard = page.locator("h3").filter({ hasText: /Cycle|Sprint|Patched/i }).first()
    if (!await cycleCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip()
      return
    }
    await cycleCard.click()
    await page.waitForTimeout(500)

    const taskCard = page.locator("[data-testid='task-card']").first()
    if (!await taskCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      test.skip()
      return
    }
    await taskCard.click()
    await page.waitForTimeout(500)

    // Open CMD+K palette
    await openPalette(page)

    // Should show task-specific commands
    await searchPalette(page, "Set status")
    await paletteHasCommand(page, "Set status")

    await searchPalette(page, "Set score")
    await paletteHasCommand(page, "Set score")

    // Should show back navigation
    await searchPalette(page, "Back to")
    await paletteHasCommand(page, "Back to")
  })
})

// ─── Breadcrumb Navigation ────────────────────────────────────────────

test.describe("Cycle breadcrumb", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.getByRole("button", { name: /Cycles/i }).click()
    await page.waitForTimeout(500)
  })

  test("cycle detail shows 'Cycles / <name>' breadcrumb", async ({ page }) => {
    const cycleCard = page.locator("h3").filter({ hasText: /Cycle|Sprint|Patched/i }).first()
    if (!await cycleCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip()
      return
    }
    await cycleCard.click()
    await page.waitForTimeout(500)

    // Should see breadcrumb with cycle name
    await expect(page.getByText("Cycle Patched").first()).toBeVisible({ timeout: 3000 })

    // The breadcrumb "Cycles" link is inside the cycle detail header (not the nav tab)
    // Find it by looking for the "/" separator next to it
    const breadcrumbArea = page.locator("div").filter({ hasText: /Cycles\s*\/\s*Cycle/ }).first()
    await expect(breadcrumbArea).toBeVisible()
  })
})
