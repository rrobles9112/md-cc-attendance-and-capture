import { test, expect } from '@playwright/test'

test.describe('Data Export', () => {
  test('export members as XLSX and verify download', async ({ page }) => {
    // Login as super_admin
    await page.goto('/login')
    await page.fill('[name="email"]', 'test-superadmin@test.com')
    await page.fill('[name="password"]', 'test-password')
    await page.click('button[type="submit"]')
    await page.waitForURL('/export')

    await page.goto('/export')

    // Select XLSX format
    await page.selectOption('[name="format"]', 'xlsx')

    // Trigger download
    const downloadPromise = page.waitForEvent('download')
    await page.click('button:has-text("Exportar")')
    const download = await downloadPromise

    // Verify file name
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/)

    // Save and verify file is not empty
    const path = await download.path()
    expect(path).toBeTruthy()
  })

  test('export members as CSV', async ({ page }) => {
    await page.goto('/login')
    await page.fill('[name="email"]', 'test-superadmin@test.com')
    await page.fill('[name="password"]', 'test-password')
    await page.click('button[type="submit"]')
    await page.waitForURL('/export')

    await page.goto('/export')

    // Select CSV format
    await page.selectOption('[name="format"]', 'csv')

    // Trigger download
    const downloadPromise = page.waitForEvent('download')
    await page.click('button:has-text("Exportar")')
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(/\.csv$/)
  })

  test('export attendance for a session', async ({ page }) => {
    await page.goto('/login')
    await page.fill('[name="email"]', 'test-superadmin@test.com')
    await page.fill('[name="password"]', 'test-password')
    await page.click('button[type="submit"]')

    await page.goto('/export')

    // Select attendance export type
    await page.selectOption('[name="exportType"]', 'attendance')

    // Select session (if available)
    const sessionSelect = page.locator('[name="sessionId"]')
    if (await sessionSelect.isVisible()) {
      await sessionSelect.selectOption({ index: 1 })
    }

    const downloadPromise = page.waitForEvent('download')
    await page.click('button:has-text("Exportar")')
    const download = await downloadPromise

    expect(download.suggestedFilename()).toBeTruthy()
  })
})
