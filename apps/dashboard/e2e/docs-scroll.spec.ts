import { test, expect } from "playwright/test"

test.describe("Docs scrolling", () => {
  test("can scroll to the bottom of a long doc and see later sections", async ({ page }) => {
    await page.goto("http://localhost:5173")
    await page.waitForLoadState("networkidle")

    await page.getByRole("button", { name: "Docs" }).click()
    await page.getByText("dd-023-cycle-scan", { exact: false }).first().click()

    await expect(page.getByRole("heading", { name: "Cycle-Based Issue Discovery" })).toBeVisible({ timeout: 10000 })

    const detailPane = page.locator("div.min-h-0.flex-1.overflow-y-auto").last()
    await expect(detailPane).toBeVisible()

    // Scroll the doc detail container itself (not the page body).
    await detailPane.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })

    // "Open Questions" is near the end of this design doc.
    await expect(page.getByRole("heading", { name: "Open Questions" })).toBeVisible({ timeout: 10000 })
  })
})

