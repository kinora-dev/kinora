import { expect, test } from '@playwright/test'
import { createApiToken, login, postRun, runOf, scanPage, testOf } from './helpers'

test.beforeEach(async ({ page }) => {
  await login(page)
})

test('pages the run table newest first and keeps the cursor in the URL', async ({ page }) => {
  const slug = `paging-${Date.now()}`
  const token = await createApiToken(page)
  const now = Date.now()
  for (let i = 0; i < 30; i++)
    await postRun(page, token, runOf(slug, new Date(now - i * 60_000), [testOf('a.spec.ts', 'works', 'expected')]))

  await page.goto(`/projects/${slug}`)
  const rows = page.getByRole('row')
  await expect(rows).toHaveCount(26)
  await expect(page.getByText('30 runs', { exact: true })).toBeVisible()
  const newest = (await rows.nth(1).getByRole('cell').first().textContent())!.trim()

  await page.getByRole('button', { name: 'Older' }).click()
  await expect(page).toHaveURL(/[?&]before=/)
  await expect(rows).toHaveCount(6)
  await scanPage(page)

  await page.reload()
  await expect(rows).toHaveCount(6)

  await page.getByRole('button', { name: 'Newer' }).click()
  await expect(page).toHaveURL(/[?&]after=/)
  await expect(rows).toHaveCount(26)
  await expect(rows.nth(1).getByRole('cell').first()).toHaveText(newest)
})
