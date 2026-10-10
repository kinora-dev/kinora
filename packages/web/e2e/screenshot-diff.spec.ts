import { expect, test } from '@playwright/test'
import { login } from './helpers'

test.beforeEach(async ({ page }) => {
  await login(page)
})

test('a failed screenshot assertion shows its images as a comparison', async ({ page }) => {
  // The seed fails the visual test of the latest design-system run and uploads its three images.
  await page.goto('/projects/design-system')
  await page.getByRole('row').nth(1).click()
  await expect(page).toHaveURL(/\/projects\/design-system\/runs\//)

  const comparison = page.getByRole('figure', { name: 'Screenshot button-primary.png' })
  const images = comparison.getByRole('img')

  // Opens on the diff, and the image really loads from the artifact store.
  await expect(comparison.getByRole('button', { name: 'Diff' })).toHaveAttribute('aria-pressed', 'true')
  await expect(images).toHaveCount(1)
  await expect(images).toHaveAttribute('alt', 'Diff screenshot of button-primary.png')
  await expect.poll(() => images.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(320)

  await comparison.getByRole('button', { name: 'Side by side' }).click()
  await expect(images).toHaveCount(2)
  await expect(comparison.getByRole('img', { name: 'Expected screenshot of button-primary.png' })).toBeVisible()
  await expect(comparison.getByRole('img', { name: 'Actual screenshot of button-primary.png' })).toBeVisible()

  // Shown inline, so not repeated as loose attachment badges.
  await expect(page.getByRole('link', { name: 'button-primary-diff.png' })).toHaveCount(0)
})

test('the test history page loads the comparison of a failed screenshot run on demand', async ({ page }) => {
  await page.goto('/projects/design-system/tests?unstable=false&q=button%20states%20match%20screenshots')
  await page.getByRole('link', { name: /button states match screenshots/ }).click()

  // Only the latest run has uploaded images, and nothing loads until asked.
  const show = page.getByRole('button', { name: 'Show screenshot comparison' })
  await expect(show).toHaveCount(1)
  await expect(page.getByRole('figure')).toHaveCount(0)

  await show.click()
  const comparison = page.getByRole('figure', { name: 'Screenshot button-primary.png' })
  await expect(comparison.getByRole('button', { name: 'Diff' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => comparison.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(320)
  await expect(show).toHaveCount(0)
})
