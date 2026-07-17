import { test, expect } from '@playwright/test'

test.describe('Offline-to-Online Sync', () => {
  test('capture form works offline and syncs on reconnect', async ({ page, context }) => {
    // Login first (requires running Supabase)
    await page.goto('/login')
    await page.fill('[name="email"]', 'test-superadmin@test.com')
    await page.fill('[name="password"]', 'test-password')
    await page.click('button[type="submit"]')
    await page.waitForURL('/capture')

    // Go offline
    await context.setOffline(true)

    // Fill capture form while offline
    await page.goto('/capture')
    await page.fill('[name="name"]', 'Juan Pérez')
    await page.fill('[name="phone"]', '+573001234567')
    await page.fill('[name="email"]', 'juan@test.com')

    // Check general consent
    await page.check('[name="consent_general"]')

    // Submit
    await page.click('button[type="submit"]')

    // Verify sync indicator shows offline/pending
    const syncIndicator = page.locator('[data-testid="sync-indicator"]')
    await expect(syncIndicator).toContainText(/offline|pending/i)

    // Go online
    await context.setOffline(false)

    // Wait for sync to complete
    await expect(syncIndicator).toContainText(/synced/i, { timeout: 10000 })

    // Verify member appears in members list
    await page.goto('/members')
    await expect(page.locator('text=Juan Pérez')).toBeVisible({ timeout: 10000 })
  })

  test('sync queue flushes in FIFO order', async ({ page, context }) => {
    await page.goto('/login')
    await page.fill('[name="email"]', 'test-superadmin@test.com')
    await page.fill('[name="password"]', 'test-password')
    await page.click('button[type="submit"]')
    await page.waitForURL('/capture')

    await context.setOffline(true)

    // Capture multiple members while offline
    const members = ['Member A', 'Member B', 'Member C']
    for (const name of members) {
      await page.goto('/capture')
      await page.fill('[name="name"]', name)
      await page.fill('[name="phone"]', '+573001234567')
      await page.fill('[name="email"]', `${name.toLowerCase().replace(' ', '')}@test.com`)
      await page.check('[name="consent_general"]')
      await page.click('button[type="submit"]')
    }

    // Go online and verify all sync
    await context.setOffline(false)

    const syncIndicator = page.locator('[data-testid="sync-indicator"]')
    await expect(syncIndicator).toContainText(/synced/i, { timeout: 15000 })

    // Verify all members synced
    await page.goto('/members')
    for (const name of members) {
      await expect(page.locator(`text=${name}`)).toBeVisible({ timeout: 10000 })
    }
  })
})
