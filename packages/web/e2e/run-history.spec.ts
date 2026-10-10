import { expect, test } from '@playwright/test'
import { findTwoRuns, login } from './helpers'

test.beforeEach(async ({ page }) => {
  await login(page)
})

test('sorting the run table resets the page and keeps the order in the URL', async ({ page }) => {
  const { slug } = await findTwoRuns(page)
  await page.goto(`/projects/${slug}?page=2`)

  const health = page.getByRole('columnheader').getByRole('button', { name: 'Health' })
  await health.click()
  await expect(page).toHaveURL(/[?&]sort=health(&|$)/)
  await expect(page).not.toHaveURL(/[?&]page=/)
  await expect(page).not.toHaveURL(/[?&]dir=/)

  await health.click()
  await expect(page).toHaveURL(/[?&]dir=asc(&|$)/)

  // A shared link restores the same order.
  await page.reload()
  await expect(health.locator('svg.lucide-arrow-up')).toBeVisible()
})
