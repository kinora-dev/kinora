import { expect, test } from './fixtures'

test.use({ baseURL: 'https://pay.demo.kinora.dev' })

test('throttles past the quota', async ({ page }) => {
  await page.goto('/developers/usage')
  await page.getByRole('button', { name: 'Send 12 requests' }).click()

  await expect(page.getByRole('row')).toHaveCount(13)
  await expect(page.getByTestId('last-status')).toHaveText('429 Too Many Requests')
})
