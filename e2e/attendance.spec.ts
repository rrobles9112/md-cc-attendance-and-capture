import { execFileSync } from 'node:child_process'
import { test, expect, type Page } from '@playwright/test'

const PAGINATION_MEMBER_SQL = `
INSERT INTO public.members (
  id, name, name_normalized, phone, email, is_minor,
  has_whatsapp, consent_recorded, sensitive_consent_recorded,
  duplicate_flag, created_by, created_at, updated_at, deleted_at
)
SELECT
  ('d0000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
  'E2E Member ' || lpad(g::text, 3, '0'),
  'e2e member ' || lpad(g::text, 3, '0'),
  '+57321' || lpad(g::text, 7, '0'),
  'e2e-member-' || g || '@test.com',
  false, false, true, false, false,
  'a0000000-0000-4000-8000-000000000002',
  now(), now(), NULL
FROM generate_series(1, 100) AS g
ON CONFLICT (id) DO NOTHING
`.trim()

function seedPaginationMembers(): void {
  execFileSync('npx', ['supabase', 'db', 'query', '--local', PAGINATION_MEMBER_SQL], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
}

async function loginAsLeader(page: Page) {
  await page.goto('/')
  await page.fill('#email', 'test-leader@test.com')
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

async function loginAndOpenAttendance(page: Page) {
  await loginAsLeader(page)
  await page.goto('/attendance')
  await expect(page.getByRole('heading', { name: 'Asistencia' })).toBeVisible()
}

async function selectFirstSession(page: import('@playwright/test').Page) {
  const sessionSelector = page.getByRole('combobox').first()
  await expect(sessionSelector).toBeVisible()
  await sessionSelector.click()
  await page.getByRole('option').first().click()
}

function presentCount(text: string | null): number {
  const match = text?.match(/^(\d+) \/ \d+ presentes$/)
  if (!match) throw new Error(`Unexpected attendance badge: ${text}`)
  return Number(match[1])
}

test.describe('Attendance Marking', () => {
  test.beforeAll(() => {
    seedPaginationMembers()
  })

  test('create session and mark attendance', async ({ page }) => {
    await loginAndOpenAttendance(page)

    await page.getByRole('button', { name: 'Nueva sesión' }).click()
    await page.fill('#sessionName', 'Viernes Test')
    await page.fill('#sessionDate', '2026-07-17')
    await page.getByRole('button', { name: 'Crear' }).click()

    await expect(page.getByText(/^\d+ \/ \d+ presentes$/)).toBeVisible()
    await expect(page.getByRole('combobox')).toContainText('Viernes Test')

    const checkbox = page.getByRole('checkbox').first()
    await checkbox.click()
    await expect(checkbox).toBeChecked()
  })

  test('counter matches checkbox state after toggle', async ({ page }) => {
    await loginAndOpenAttendance(page)
    await selectFirstSession(page)

    const badge = page.getByText(/^\d+ \/ \d+ presentes$/)
    const checkbox = page.getByRole('checkbox').first()
    await expect(checkbox).toBeVisible()

    const wasChecked = await checkbox.getAttribute('data-state') === 'checked'
    const checkedBefore = await page.locator('[role="checkbox"][data-state="checked"]').count()
    const countBefore = presentCount(await badge.textContent())
    const expectedDelta = wasChecked ? -1 : 1

    await checkbox.click()

    await expect.poll(async () =>
      page.locator('[role="checkbox"][data-state="checked"]').count()
    ).toBe(checkedBefore + expectedDelta)
    await expect.poll(async () => presentCount(await badge.textContent()))
      .toBe(countBefore + expectedDelta)
  })

  test('Cargar más loads the next 50 members', async ({ page }) => {
    await loginAndOpenAttendance(page)
    await selectFirstSession(page)

    const rows = page.locator('tbody tr')
    const loadMore = page.getByRole('button', { name: 'Cargar más' })
    await expect(rows).toHaveCount(50)
    await expect(loadMore).toBeVisible()

    await loadMore.click()

    await expect(rows).toHaveCount(100)
  })

  test('Cargar más is hidden when all members are loaded', async ({ page }) => {
    await loginAndOpenAttendance(page)
    await selectFirstSession(page)

    const loadMore = page.getByRole('button', { name: 'Cargar más' })
    while (await loadMore.isVisible()) {
      await loadMore.click()
    }

    await expect(loadMore).toBeHidden()
  })

  test('shows the no-results empty state for an unmatched search', async ({ page }) => {
    await loginAndOpenAttendance(page)
    await selectFirstSession(page)

    await page.getByPlaceholder('Buscar miembro...').fill('no-member-matches-this-query')

    await expect(page.getByText('No se encontraron miembros')).toBeVisible()
  })

  test('realtime update visible in second context', async ({ browser }) => {
    // Create two browser contexts (two users)
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()
    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    await loginAndOpenAttendance(page1)
    await loginAndOpenAttendance(page2)
    await selectFirstSession(page1)
    await selectFirstSession(page2)

    const checkbox1 = page1.getByRole('checkbox').first()
    await checkbox1.click()

    const checkbox2 = page2.getByRole('checkbox').first()
    await expect(checkbox2).toBeChecked({ timeout: 5000 })

    await context1.close()
    await context2.close()
  })
})
