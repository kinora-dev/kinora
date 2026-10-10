import { devices } from '@playwright/test'
import { expect, test } from './fixtures'

const { defaultBrowserType: _, ...iPhone } = devices['iPhone 15']
test.use({ ...iPhone, baseURL: 'https://pulse.demo.kinora.dev' })

test('loads the next page', async ({ page }) => {
  await page.goto('/feed')
  await expect(page.getByRole('article')).toHaveCount(10)

  await page.getByRole('button', { name: 'Load more' }).click()

  await expect(page.getByRole('article')).toHaveCount(20)
})
