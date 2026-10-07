import { expect, test } from '@playwright/test'
import { login } from './helpers'

test.beforeEach(async ({ page }) => {
  await login(page)
})

test('components page groups seeded stories by component', async ({ page }) => {
  await page.goto('/projects/design-system')
  await page.getByRole('link', { name: 'Components' }).click()
  await expect(page).toHaveURL('/projects/design-system/components')

  const button = page.getByRole('region', { name: 'Button' })
  await expect(button.getByText('3 stories')).toBeVisible()
  for (const story of ['Disabled', 'Loading', 'Primary'])
    await expect(button.getByText(story, { exact: true })).toBeVisible()

  // `Dialog/Default` and `components/Dialog/Default` are one story with two tests.
  const dialog = page.getByRole('region', { name: 'Dialog' })
  await expect(dialog.getByText('1 story')).toBeVisible()
  await expect(dialog.getByRole('link', { name: /closes on escape/ })).toBeVisible()
  await dialog.getByRole('link', { name: /traps focus/ }).click()
  await expect(page).toHaveURL(/\/projects\/design-system\/test\?key=/)
})

test('components page filters stories by search', async ({ page }) => {
  await page.goto('/projects/design-system/components?q=select')

  await expect(page.getByRole('region', { name: 'Select' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Button' })).toHaveCount(0)
})

test('components page explains itself on a project without stories', async ({ page }) => {
  await page.goto('/projects/web-app/components')

  await expect(page.getByText('No component stories recorded yet.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Component testing guide' })).toBeVisible()
})
