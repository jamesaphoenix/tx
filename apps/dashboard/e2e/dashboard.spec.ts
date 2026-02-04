/**
 * Dashboard E2E Test
 *
 * Verifies the dashboard loads and displays data from the API.
 *
 * Run with: npx playwright test apps/dashboard/e2e/dashboard.spec.ts
 */

import { test, expect } from '@playwright/test'

test.describe('Dashboard', () => {
  test('loads and displays runs from API', async ({ page }) => {
    // Navigate to dashboard
    await page.goto('http://localhost:5173')

    // Wait for the page to load
    await page.waitForLoadState('networkidle')

    // Check the page title or header
    const header = page.locator('h1, [role="heading"]').first()
    await expect(header).toBeVisible({ timeout: 10000 })

    // Verify API requests are working by checking for run data
    // Wait for any content that indicates data loaded
    await page.waitForSelector('text=/run-|completed|failed|running/i', { timeout: 10000 })

    // Take a screenshot for verification
    await page.screenshot({ path: 'e2e/screenshots/dashboard-loaded.png', fullPage: true })

    console.log('✓ Dashboard loaded successfully with data from API')
  })

  test('API proxy returns valid JSON', async ({ request }) => {
    // Test the proxy directly
    const response = await request.get('http://localhost:5173/api/runs?limit=5')

    expect(response.ok()).toBeTruthy()
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(data).toHaveProperty('runs')
    expect(data).toHaveProperty('total')
    expect(Array.isArray(data.runs)).toBeTruthy()

    console.log(`✓ API proxy returned ${data.runs.length} runs (total: ${data.total})`)
  })

  test('stats endpoint works', async ({ request }) => {
    const response = await request.get('http://localhost:5173/api/stats')

    expect(response.ok()).toBeTruthy()
    const data = await response.json()

    // Stats should have some structure
    expect(data).toBeDefined()
    console.log('✓ Stats endpoint working')
  })
})
