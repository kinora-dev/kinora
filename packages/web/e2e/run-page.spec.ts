import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createApiToken, login, runOf, SERVER_URL, testOf } from './helpers'

// A run can carry tens of thousands of tests: its page lists them 50 at a time.
test('the run page pages its tests and a filter goes back to the first page', async ({ page }) => {
  await login(page)
  const token = await createApiToken(page)
  const slug = `run-page-${randomUUID().slice(0, 8)}`
  const tests = Array.from({ length: 120 }, (_, i) => testOf('tests/paged.spec.ts', `case ${String(i).padStart(3, '0')}`, i % 20 === 0 ? 'unexpected' : 'expected'))
  const res = await page.request.post(`${SERVER_URL}/api/v1/runs?backfill=1`, { headers: { Authorization: `Bearer ${token}` }, data: runOf(slug, new Date(), tests) })
  const { runId } = await res.json() as { runId: string }

  await page.goto(`/projects/${slug}/runs/${runId}`)
  const cards = page.getByText(/^case \d{3}$/)
  await expect(cards).toHaveCount(50)
  await expect(page.getByText('120 tests')).toBeVisible()
  // The 6 failures lead the first page, ahead of the passing tests reported before them.
  await expect(cards.nth(5)).toHaveText('case 100')
  await expect(cards.nth(6)).toHaveText('case 001')

  await page.getByRole('button', { name: 'Page 3' }).click()
  await expect(page).toHaveURL(/[?&]page=3(&|$)/)
  await expect(cards).toHaveCount(20)

  await page.getByRole('tab', { name: /Failed/ }).click()
  await expect(page).not.toHaveURL(/[?&]page=/)
  await expect(cards).toHaveCount(6)
})
