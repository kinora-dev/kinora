import { expect, test } from './fixtures'

test.use({ baseURL: 'https://pay.demo.kinora.dev' })

test('charges a card', async ({ page }) => {
  await page.goto('/orders/ord_1043')
  await expect(page.getByTestId('order-status')).toHaveText('Authorized')

  await page.getByRole('button', { name: 'Capture $348.00' }).click()

  await expect(page.getByTestId('order-status')).toHaveText('Paid')
  await expect(page.getByRole('status')).toHaveText('Payment captured. Receipt emailed to priya@example.com.')
})

test('refunds an order', async ({ page }) => {
  await page.goto('/orders/ord_1042')
  await page.getByRole('button', { name: 'Refund', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Refund $129.00' }).click()

  await expect(page.getByRole('status')).toHaveText('Refund issued. Funds return in 5 to 10 days.')
  await expect(page.getByTestId('order-status')).toHaveText('Refunded')
})
