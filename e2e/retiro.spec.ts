import { test, expect } from '@playwright/test'

test.describe('Public retreat pre-registration', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('unauthenticated GET /retiro shows the Spanish retreat form', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'Chromium is enough for the public-form smoke')

    await page.goto('/retiro')

    await expect(page).toHaveURL(/\/retiro\/?$/)
    await expect(page).not.toHaveURL('/')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.getByText('Inicie sesión para continuar')).toHaveCount(0)

    await expect(
      page.getByRole('heading', { name: 'Retiro Juvenil Octubre 2026' }),
    ).toBeVisible()
    await expect(page.getByLabel(/Nombre completo/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Preinscribirme al retiro' })).toBeVisible()

    await expect(page.getByText(/PREINSCRIPCIÓN AL RETIRO JUVENIL/)).toBeVisible()
    await expect(page.getByText(/Ley 1581/).first()).toBeVisible()
    await expect(page.getByText(/ARCO/)).toBeVisible()

    await expect(page.getByLabel(/monto|pago|amount/i)).toHaveCount(0)
  })
})
