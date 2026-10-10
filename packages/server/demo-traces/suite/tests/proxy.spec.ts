import { expect, test } from './fixtures'

test.use({ baseURL: 'https://gateway.demo.kinora.dev' })

test('streams a large response', async ({ page }) => {
  await page.goto('/routes/exports-api')
  await page.getByRole('button', { name: 'Send request' }).click()

  await expect(page.getByTestId('response-status')).toHaveText('200 OK')
  await expect(page.getByTestId('stream-rows')).toHaveText('5,000 rows')
})

test('retries on upstream 503', async ({ page }) => {
  await page.goto('/routes/orders-api')
  await page.getByLabel('Path').fill('/v1/orders/42')
  await page.getByRole('button', { name: 'Send request' }).click()

  await expect(page.getByTestId('response-status')).toHaveText('200 OK')
  await expect(page.getByTestId('attempts').getByRole('listitem')).toHaveCount(3)
})
