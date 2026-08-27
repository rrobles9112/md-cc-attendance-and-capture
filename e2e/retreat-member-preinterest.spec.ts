import { test, expect } from '@playwright/test'

// RED skeleton: these tests intentionally look for UI elements that do not exist yet.
// They must FAIL before GREEN (missing button/dialog/badge). Do not wire implementation here.

test.describe('retreat-member-preinterest - member to retreat flow', () => {
  test('leader sees Preinscribir button, prefilled editable retreat form, submits and sees toast + badge', async ({ page }) => {
    await page.goto('/members')

    const preinscribeButton = page.getByRole('button', { name: 'Preinscribir al retiro' })
    await expect(preinscribeButton).toBeVisible({ timeout: 2000 })

    await preinscribeButton.click()

    // Second dialog with CaptureForm variant retreat prefilled
    await expect(page.getByText('Preinscribir a')).toBeVisible()
    await expect(page.getByLabel('Nombre completo')).toHaveValue(/.*/)
    await expect(page.getByLabel('Correo electrónico')).toHaveValue(/.*/)

    // Editable prefill
    const phoneInput = page.getByLabel('Teléfono')
    await phoneInput.fill('3009998888')
    await expect(phoneInput).toHaveValue('3009998888')

    // Consent forced unchecked
    await expect(page.getByLabel('He leído y acepto')).not.toBeChecked()

    // Submit would call RPC and show toast — skeleton expects toast selector exists after submit
    await page.getByLabel('He leído y acepto').check()
    await page.getByRole('button', { name: /Preinscribir|Enviar/ }).click()

    await expect(page.getByText('Preinscripción creada')).toBeVisible()
    await expect(page.getByText('Preinscrito')).toBeVisible()
  })

  test('isolation: members directory load does not bulk fetch retreat_registrations before detail click', async ({ page }) => {
    const bulkRequests: string[] = []
    await page.route('**/rest/v1/retreat_registrations*', (route) => {
      const url = route.request().url()
      // capture any retreat_registrations request during initial load
      bulkRequests.push(url)
      return route.continue()
    })

    await page.goto('/members')
    // wait for directory to finish loading
    await expect(page.getByText('Miembros')).toBeVisible()
    // before opening any detail, there should be no bulk SELECT returning multiple rows
    // RED: this assertion expects isolation — but also expects at least no bulk before detail
    // Since isolation is about not calling retreat_registrations at all during directory load, we check requests
    const bulkSelects = bulkRequests.filter((u) => !u.includes('member_id=eq.') && !u.includes('event_key=eq.'))
    expect(bulkSelects.length).toBe(0)

    await page.unroute('**/rest/v1/retreat_registrations*')
  })

  test('duplicate friendly error toast with Ver en Retiro link', async ({ page }) => {
    await page.goto('/members')
    const preinscribeButton = page.getByRole('button', { name: 'Preinscribir al retiro' })
    await expect(preinscribeButton).toBeVisible()
    await preinscribeButton.click()

    // After duplicate submit, UI must show Spanish toast
    await page.getByLabel('He leído y acepto').check()
    await page.getByRole('button', { name: /Preinscribir|Enviar/ }).click()

    await expect(page.getByText('Ya existe una preinscripción')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ver en Retiro' })).toBeVisible()
    await page.getByRole('button', { name: 'Ver en Retiro' }).click()
    await expect(page).toHaveURL(/retreat-registrations/)
  })

  test('offline: button disabled with Requiere conexión and no rpc request', async ({ page, context }) => {
    await context.setOffline(true)
    await page.goto('/members')

    const preinscribeButton = page.getByRole('button', { name: 'Preinscribir al retiro' })
    // RED: before GREEN, button either not found or not disabled correctly
    await expect(preinscribeButton).toBeDisabled()
    await expect(preinscribeButton).toHaveAttribute('title', 'Requiere conexión')

    let rpcCalled = false
    await page.route('**/rest/v1/rpc/register_retreat_preinscription_for_member*', (route) => {
      rpcCalled = true
      return route.continue()
    })

    await preinscribeButton.click({ force: true })
    expect(rpcCalled).toBe(false)

    await context.setOffline(false)
    await page.unroute('**/rest/v1/rpc/register_retreat_preinscription_for_member*')
  })

  test('server role cannot see button and direct rpc is denied', async ({ page }) => {
    await page.goto('/members')

    // Server should not see preinscribe button
    await expect(page.getByRole('button', { name: 'Preinscribir al retiro' })).toBeHidden()

    // Direct RPC via page.evaluate should fail with not_authorized / insufficient
    const result = await page.evaluate(async () => {
      try {
        // @ts-ignore supabase global may not exist in test env; this path intentionally fails if implementation missing
        const { createClient } = await import('@/lib/supabase/client')
        const supabase = createClient()
        const { error } = await (supabase as unknown as { rpc: (name: string, params: unknown) => Promise<{ error: unknown }> }).rpc(
          'register_retreat_preinscription_for_member',
          {
            p_member_id: '00000000-0000-4000-8000-000000000099',
            p_general_consent: true,
          },
        )
        return error ? String((error as { message?: string }).message ?? error) : 'no-error'
      } catch (e) {
        return String(e)
      }
    })

    expect(result).toMatch(/not_authorized|insufficient|permission denied|already_preinscribed|member not found/i)
  })
})
