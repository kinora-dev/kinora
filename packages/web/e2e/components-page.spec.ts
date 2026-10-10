import { expect, test } from '@playwright/test'
import { login, openStory } from './helpers'

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
  await expect(dialog.getByRole('button', { name: 'Default, 2 tests' })).toBeVisible()
  await openStory(dialog, 'Default')
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

test('components page shares the unstable filter with the tests page', async ({ page }) => {
  await page.goto('/projects/design-system/components')

  await page.getByRole('button', { name: 'Unstable only' }).click()
  await expect(page).toHaveURL(/unstable=true/)
  await expect(page.getByText('Failing now')).toBeVisible()
})

test('a story badge on a run links to that story on the components page', async ({ page }) => {
  await page.goto('/projects/design-system')
  await page.getByRole('row').nth(1).click()
  await expect(page).toHaveURL(/\/projects\/design-system\/runs\//)

  // Shown as a badge, not as the raw `kinora:story` annotation. Which tests carry one varies
  // (seeded statuses are random and a skipped test mounts nothing), so follow the first badge.
  const badge = page.getByRole('link', { name: /^\w+ \/ \w+$/ }).first()
  const [component, story] = ((await badge.textContent()) ?? '').trim().split(' / ')
  await expect(page.getByText('kinora:story')).toHaveCount(0)
  await badge.click()

  await expect(page).toHaveURL(/\/projects\/design-system\/components\?q=/)
  const region = page.getByRole('region', { name: component })
  await expect(region.getByText(story, { exact: true })).toBeVisible()
  await expect(page.locator('section').filter({ has: page.getByRole('heading', { level: 2 }) })).toHaveCount(1)
})

test('the test history page links to the stories the test mounts', async ({ page }) => {
  await page.goto('/projects/design-system/components?q=Loading')
  await openStory(page.getByRole('region', { name: 'Button' }), 'Loading')
  await page.getByRole('link', { name: /button states match screenshots/ }).click()

  for (const story of ['Button / Primary', 'Button / Disabled', 'Button / Loading'])
    await expect(page.getByRole('link', { name: story })).toBeVisible()
})

test('folds the tests of a passing story until it is opened', async ({ page }) => {
  // Seeded statuses are random: fold it first if it happens to be failing now.
  await page.goto('/projects/design-system/components?q=Primary')
  const button = page.getByRole('region', { name: 'Button' })
  const toggle = button.getByRole('button', { name: /^Primary, \d+ tests?$/ })
  const link = button.getByRole('link', { name: /primary button submits/ })

  if (await toggle.getAttribute('aria-expanded') === 'true')
    await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(link).toHaveCount(0)

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(link).toBeVisible()
})
