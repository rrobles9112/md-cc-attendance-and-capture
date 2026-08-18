import { test, expect, type Page } from '@playwright/test'

async function loginAs(page: Page, email: string) {
  await page.goto('/')
  await page.fill('#email', email)
  await page.fill('#password', 'test-password')
  await page.click('button[type="submit"]')

  const loginError = page.locator('form .text-destructive')
  const outcome = await Promise.race([
    page.waitForURL('**/capture').then(() => 'ok' as const),
    loginError.waitFor({ state: 'visible' }).then(() => 'error' as const),
  ])
  if (outcome === 'error') {
    throw new Error(`Login failed: ${(await loginError.textContent())?.trim() ?? 'unknown error'}`)
  }
}

test.describe('Role Enforcement', () => {
  test('leader cannot see delete button', async ({ page }) => {
    await loginAs(page, 'test-leader@test.com')
    await page.goto('/members')

    const deleteButtons = page.locator('button:has-text("Eliminar"), button[aria-label*="delete"], button[aria-label*="Delete"]')
    await expect(deleteButtons).toHaveCount(0)
  })

  test('leader DELETE API returns 403', async ({ page }) => {
    test.skip(true, 'Next.js does not proxy PostgREST at /rest/v1; RLS delete is covered by SQL tests')
    await loginAs(page, 'test-leader@test.com')

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
    await loginAs(page, 'test-server@test.com')

    const captureLink = page.locator('a[href="/capture"], nav a:has-text("Captura")')
    await expect(captureLink).toHaveCount(0)

    await page.goto('/capture')
    await expect(page.getByText('No tiene permisos para acceder a esta sección')).toBeVisible()
    await expect(page.getByRole('button', { name: /registrar miembro/i })).toHaveCount(0)
  })

  test('server cannot see retreat registrations route', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Chromium is enough for retreat RBAC smoke')
    await loginAs(page, 'test-server@test.com')

    const retreatLink = page.locator('a[href="/retreat-registrations"]')
    await expect(retreatLink).toHaveCount(0)

    await page.goto('/retreat-registrations')
    await expect(page.getByText('No tiene permisos para acceder a esta sección')).toBeVisible()
    await expect(page.getByRole('button', { name: /registrar pago/i })).toHaveCount(0)
  })

  test('leader can see retreat registrations nav link', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Chromium is enough for retreat RBAC smoke')
    await loginAs(page, 'test-leader@test.com')

    await expect(page.locator('a[href="/retreat-registrations"]')).toBeVisible()
  })

  test('leader opens staff retreat page without AdminPage', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Chromium is enough for retreat RBAC smoke')
    await loginAs(page, 'test-leader@test.com')

    await page.locator('a[href="/retreat-registrations"]').click()
    await expect(page).toHaveURL(/\/retreat-registrations/)
    await expect(page.getByRole('heading', { name: 'Preinscripciones al retiro' })).toBeVisible()
    await expect(page.getByText('Consulte las preinscripciones y registre cuotas consecutivas')).toBeVisible()
    await expect(page.locator('a[href="/admin"]')).toHaveCount(0)
    await expect(page.getByText('Costo total del retiro', { exact: true })).toHaveCount(0)
  })

  test('leader can load retreat registrations route without AdminPage', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Chromium is enough for retreat RBAC smoke')
    await loginAs(page, 'test-leader@test.com')

    await page.goto('/retreat-registrations')
    await expect(page).toHaveURL(/\/retreat-registrations/)
    await expect(page.getByRole('heading', { name: 'Preinscripciones al retiro' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Registrar pago' })).toBeVisible()
    await expect(page.getByText('No tiene permisos para acceder a esta sección')).toHaveCount(0)
  })

  test('super_admin can see retreat registrations nav link', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Chromium is enough for retreat RBAC smoke')
    await loginAs(page, 'test-superadmin@test.com')

    await expect(page.locator('a[href="/retreat-registrations"]')).toBeVisible()
  })

  test('super_admin can see all features', async ({ page }) => {
    await loginAs(page, 'test-superadmin@test.com')

    await expect(page.locator('a[href="/capture"]')).toBeVisible()
    await expect(page.locator('a[href="/attendance"]')).toBeVisible()
    await expect(page.locator('a[href="/members"]')).toBeVisible()
    await expect(page.locator('a[href="/admin"]')).toBeVisible()
    await expect(page.locator('a[href="/export"]')).toBeVisible()
    await expect(page.locator('a[href="/retreat-registrations"]')).toBeVisible()
  })
})
