import { expect, test } from '@playwright/test'
import { DEMO, login } from './helpers'

test('redirects guests to login', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
})

test('login page offers social and email sign-in', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: /Continue with GitHub/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeVisible()
  await expect(page.locator('input[type="email"]')).toBeVisible()
  await expect(page.locator('input[type="password"]')).toBeVisible()
})

test('rejects invalid credentials', async ({ page }) => {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill('demo@kinora.dev')
  await page.locator('input[type="password"]').fill('wrong-password')
  await page.locator('button[type="submit"]').click()
  await expect(page.locator('p.text-fail')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})

test('logs in and reaches the overview', async ({ page }) => {
  await login(page)
  await expect(page.getByRole('heading', { name: 'Test runs overview' })).toBeVisible()
})

test('honors the post-login redirect', async ({ page }) => {
  await page.goto('/login?redirect=/settings/account')
  await page.locator('input[type="email"]').fill(DEMO.email)
  await page.locator('input[type="password"]').fill(DEMO.password)
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL('/settings/account')
})

test('signs up and reaches the app', async ({ page }) => {
  await page.goto('/signup')
  // The @test.dev domain makes Polar reject the customer -> this also asserts sign-up
  // succeeds even when the billing provider fails (non-fatal customer creation).
  const email = `signup-${Date.now()}@test.dev`
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').nth(0).fill('password123')
  await page.locator('input[type="password"]').nth(1).fill('password123')
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('button', { name: /workspace/i })).toBeVisible()
})

test('rejects sign-up with mismatched passwords', async ({ page }) => {
  await page.goto('/signup')
  await page.locator('input[type="email"]').fill(`mismatch-${Date.now()}@test.dev`)
  await page.locator('input[type="password"]').nth(0).fill('password123')
  await page.locator('input[type="password"]').nth(1).fill('different456')
  await page.locator('button[type="submit"]').click()
  await expect(page.getByText(/do not match/i)).toBeVisible()
  await expect(page).toHaveURL(/\/signup/)
})

test('rejects sign-up with an existing email', async ({ page }) => {
  await page.goto('/signup')
  await page.locator('input[type="email"]').fill(DEMO.email)
  await page.locator('input[type="password"]').nth(0).fill('password123')
  await page.locator('input[type="password"]').nth(1).fill('password123')
  await page.locator('button[type="submit"]').click()
  await expect(page.locator('p.text-fail')).toBeVisible()
  await expect(page).toHaveURL(/\/signup/)
})

test('signs out back to login', async ({ page }) => {
  await login(page)
  await page.getByTitle('Demo User').click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
})

test('a session that ends mid-use sends the user back to login', async ({ page }) => {
  await login(page)

  // Same as the session expiring or being revoked: the next API call comes back 401.
  await page.context().clearCookies()
  await page.getByRole('link', { name: 'Web App' }).click()

  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})
