import { expect, test } from '@playwright/test'
import { createApiToken, login, postRun, runOf, scanPage, testOf } from './helpers'

const DAY = 86_400_000

// The Analytics page of a project with known runs: three days, two branches.
test('analytics shows the outcomes of the range and filters by branch', async ({ page }) => {
  await login(page)
  const slug = `analytics-${Date.now()}`
  const token = await createApiToken(page)
  const run = (daysAgo: number, branch: string, statuses: ('expected' | 'flaky' | 'unexpected')[]) =>
    postRun(page, token, runOf(slug, new Date(Date.now() - daysAgo * DAY), statuses.map((s, i) => testOf('tests/cart.spec.ts', `test ${i}`, s)), { branch }))
  await run(2, 'main', ['expected', 'expected', 'unexpected'])
  await run(1, 'develop', ['expected', 'flaky', 'expected'])
  await run(0, 'main', ['expected', 'expected', 'expected'])

  await page.goto(`/projects/${slug}`)
  await page.getByRole('link', { name: /Analytics/ }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${slug}/analytics`))

  // Every run of the last 30 days: 7 passed, 1 flaky, 1 failed out of 9 results, one area per outcome.
  const stat = (label: string) => page.getByRole('group', { name: 'Range totals' }).getByText(label, { exact: true }).locator('..')
  await expect(stat('Runs')).toContainText('3')
  await expect(stat('Passed')).toContainText('77.8%')
  await expect(stat('Failed')).toContainText('11.1%')
  await expect(page.locator('[data-slot="chart"] path[class$="-area"]')).toHaveCount(3)
  // The same rates on their own scale: one line for flaky, one for failed.
  await expect(page.locator('[data-slot="chart"] path[class$="-linePath"]')).toHaveCount(2)
  await expect(page.getByText('per day')).toBeVisible()
  await scanPage(page)

  await page.getByRole('radio', { name: '90 days' }).click()
  await expect(page).toHaveURL(/range=90/)
  await expect(page.getByText('per week')).toBeVisible()

  await page.getByRole('combobox').filter({ hasText: 'All branches' }).click()
  await page.getByRole('option', { name: 'develop' }).click()
  await expect(page).toHaveURL(/branch=develop/)
  await expect(stat('Runs')).toContainText('1')
  await expect(stat('Flaky')).toContainText('33.3%')
})
