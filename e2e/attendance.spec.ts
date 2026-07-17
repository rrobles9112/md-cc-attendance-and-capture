import { test, expect } from '@playwright/test'

test.describe('Attendance Marking', () => {
  test('create session and mark attendance', async ({ page }) => {
    // Login as leader
    await page.goto('/login')
    await page.fill('[name="email"]', 'test-leader@test.com')
    await page.fill('[name="password"]', 'test-password')
    await page.click('button[type="submit"]')
    await page.waitForURL('/attendance')

    // Create a new session
    await page.goto('/attendance')
    await page.fill('[name="sessionName"]', 'Viernes Test')
    await page.fill('[name="sessionDate"]', '2026-07-17')
    await page.click('button:has-text("Crear Sesión")')

    // Verify session appears
    await expect(page.locator('text=Viernes Test')).toBeVisible()

    // Mark attendance for a member
    const checkbox = page.locator('[data-testid="attendance-checkbox"]').first()
    await checkbox.check()

    // Verify attendance was marked
    await expect(checkbox).toBeChecked()
  })

  test('realtime update visible in second context', async ({ browser }) => {
    // Create two browser contexts (two users)
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()
    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    // Both login
    for (const page of [page1, page2]) {
      await page.goto('/login')
      await page.fill('[name="email"]', 'test-leader@test.com')
      await page.fill('[name="password"]', 'test-password')
      await page.click('button[type="submit"]')
      await page.waitForURL('/attendance')
    }

    // Both navigate to same session
    await page1.goto('/attendance')
    await page2.goto('/attendance')

    // User 1 marks attendance
    const checkbox1 = page1.locator('[data-testid="attendance-checkbox"]').first()
    await checkbox1.check()

    // User 2 should see the update within 2 seconds (realtime)
    const checkbox2 = page2.locator('[data-testid="attendance-checkbox"]').first()
    await expect(checkbox2).toBeChecked({ timeout: 5000 })

    await context1.close()
    await context2.close()
  })
})
