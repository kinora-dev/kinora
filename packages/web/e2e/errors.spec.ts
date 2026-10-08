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

test('a throttled session check keeps the URL instead of bouncing to login', async ({ page }) => {
  // The server's rate limiter answers outside tRPC, with a bare 429.
  await page.route('**/trpc/**', route => route.fulfill({ status: 429, json: { error: 'Too many requests' } }))
  await page.goto('/projects/web-app')

  const alert = page.getByRole('alert')
  await expect(alert.getByText('Too many requests. Try again in a moment.')).toBeVisible()
  await expect(page).toHaveURL('/projects/web-app')

  await page.unroute('**/trpc/**')
  await alert.getByRole('button', { name: 'Retry' }).click()

  await expect(page.getByRole('heading', { name: 'Web App' })).toBeVisible()
  await expect(page).toHaveURL('/projects/web-app')
})

test('an unreachable server at boot shows the error instead of the login page', async ({ page }) => {
  await page.route('**/trpc/**', route => route.abort())
  await page.goto('/projects/web-app/tests')

  await expect(page.getByRole('alert').getByText('Can\'t reach the kinora server.')).toBeVisible()
  await expect(page).toHaveURL('/projects/web-app/tests')
})
