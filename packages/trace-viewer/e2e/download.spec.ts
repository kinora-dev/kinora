import { expect, test } from '@playwright/test'

test('downloads the open trace', async ({ page }) => {
  await page.goto('/?trace=fixtures/demo.zip')
  await expect(page.getByTestId('action').first()).toBeVisible()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download trace' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('demo.zip')
})
