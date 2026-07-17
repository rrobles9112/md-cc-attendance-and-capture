import { test, expect } from '@playwright/test'

test.describe('Role Enforcement', () => {
  test('leader cannot see delete button', async ({ page }) => {
    // Login as leader
    await page.goto('/login')
    await page.fill('[name="email"]', 'test-leader@test.com')
    await page.fill('[name="password"]', 'test-password')
    await page.click('button[type="submit"]')
    await page.waitForURL('/members')

    await page.goto('/members')

    // Delete button should not be visible for leader
    const deleteButtons = page.locator('button:has-text("Eliminar"), button[aria-label*="delete"], button[aria-label*="Delete"]')
    await expect(deleteButtons).toHaveCount(0)
  })

  test('leader DELETE API returns 403', async ({ page }) => {
    // Login as leader
    await page.goto('/login')
    await page.fill('[name="email"]', 'test-leader@test.com')
    await page.fill('[name="password"]', 'test-password')
    await page.click('button[type="submit"]')

    // Attempt direct DELETE via API
    const response = await page.evaluate(async () => {
      const res = await fetch('/rest/v1/members?id=eq.fake-id', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      })
      return res.status
    })

    expect(response).toBe(403)
  })

  test('server cannot see capture route', async ({ page }) => {
    // Login as server
    await page.goto('/login')
    await page.fill('[name="email"]', 'test-server@test.com')
    await page.fill('[name="password"]', 'test-password')
    await page.click('button[type="submit"]')

    // Capture nav item should not be visible
    const captureLink = page.locator('a[href="/capture"], nav a:has-text("Captura")')
    await expect(captureLink).toHaveCount(0)

    // Direct navigation should be blocked
    await page.goto('/capture')
    await expect(page).not.toHaveURL('/capture')
  })

  test('super_admin can see all features', async ({ page }) => {
    await page.goto('/login')
    await page.fill('[name="email"]', 'test-superadmin@test.com')
    await page.fill('[name="password"]', 'test-password')
    await page.click('button[type="submit"]')

    // Verify all nav items visible
    await expect(page.locator('a[href="/capture"]')).toBeVisible()
    await expect(page.locator('a[href="/attendance"]')).toBeVisible()
    await expect(page.locator('a[href="/members"]')).toBeVisible()
    await expect(page.locator('a[href="/admin"]')).toBeVisible()
    await expect(page.locator('a[href="/export"]')).toBeVisible()
  })
})
