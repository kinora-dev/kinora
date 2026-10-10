import { expect, test } from './fixtures'

test.use({ baseURL: 'https://store.demo.kinora.dev' })

test.beforeEach(async ({ page }) => {
  await page.goto('/checkout')
})

test('completes a purchase', async ({ page }) => {
  await page.getByLabel('Customer email').fill('alex@example.com')
  await page.getByRole('button', { name: 'Complete checkout' }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Order complete')
  await expect(page.getByRole('status')).toHaveText('Receipt sent to alex@example.com.')
})

test('applies a discount code', async ({ page }) => {
  await page.getByLabel('Discount code').fill('LAUNCH20')
  await page.getByRole('button', { name: 'Apply' }).click()

  await expect(page.getByText('LAUNCH20 applied')).toBeVisible()
  await expect(page.getByTestId('total')).toHaveText('$23.20')
})
