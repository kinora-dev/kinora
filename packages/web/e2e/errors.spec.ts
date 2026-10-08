import { expect, test } from '@playwright/test'
import { login } from './helpers'

test.beforeEach(async ({ page }) => {
  await login(page)
})

test('an unreachable server shows a readable error and recovers on retry', async ({ page }) => {
  // Cut the API after login, then navigate in-app so the session check isn't what fails.
  await page.route('**/trpc/**', route => route.abort())
  await page.getByRole('link', { name: 'Web App' }).click()

  const alert = page.getByRole('alert')
  await expect(alert.getByText('Can\'t reach the kinora server.')).toBeVisible()

  await page.unroute('**/trpc/**')
  await alert.getByRole('button', { name: 'Retry' }).click()

  await expect(page.getByRole('heading', { name: 'Web App' })).toBeVisible()
  await expect(alert).toHaveCount(0)
})

test('a missing project explains itself without offering a retry', async ({ page }) => {
  await page.goto('/projects/does-not-exist/tests')

  const alert = page.getByRole('alert')
  await expect(alert.getByText('This page doesn\'t exist or you don\'t have access to it.')).toBeVisible()
  await expect(alert.getByText('Project not found')).toBeVisible()
  await expect(alert.getByRole('button', { name: 'Retry' })).toHaveCount(0)
})
