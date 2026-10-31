import { expect, test } from '@playwright/test'
import { login, scanPage } from './helpers'

test.beforeEach(async ({ page }) => {
  await login(page)
})

test('lists the seeded projects', async ({ page }) => {
  await expect(page.getByRole('link', { name: 'Web App' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'API Gateway' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Marketing Site' })).toBeVisible()
  await scanPage(page)
})

test('filters the overview by tag', async ({ page }) => {
  await page.goto('/?tag=@smoke')
  // Only Web App carries @smoke-tagged tests in the seed.
  await expect(page.getByRole('link', { name: 'Web App' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'API Gateway' })).toHaveCount(0)
  await expect(page.getByText('@smoke / latest')).toBeVisible()
})

test('a failed filter change keeps the filters', async ({ page }) => {
  await page.goto('/?tag=@smoke')
  await expect(page.getByRole('link', { name: 'Web App' })).toBeVisible()

  await page.route('**/trpc/dashboard.overview**', route => route.abort())
  await page.getByRole('button', { name: 'Clear' }).click()

  const alert = page.getByRole('alert')
  await expect(alert.getByText('Can\'t reach the kinora server.')).toBeVisible()
  await expect(page.getByRole('combobox').filter({ hasText: 'All branches' })).toBeVisible()

  await page.unroute('**/trpc/dashboard.overview**')
  await alert.getByRole('button', { name: 'Retry' }).click()

  await expect(page.getByRole('link', { name: 'API Gateway' })).toBeVisible()
})
