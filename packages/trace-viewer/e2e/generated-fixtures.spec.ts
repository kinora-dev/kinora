import { expect, test } from '@playwright/test'

async function openTrace(page: import('@playwright/test').Page, fixture: string): Promise<void> {
  await page.goto(`/?trace=fixtures/${fixture}`)
  await expect(page.getByTestId('action').first()).toBeVisible()
}

test('generated iframe fixture replays nested frame snapshots', async ({ page }) => {
  await openTrace(page, 'iframe-trace.zip')

  await expect(page.getByTestId('action').filter({ hasText: 'Fill "Alex Example"' })).toBeVisible()
  await expect(page.frameLocator('iframe[name="snapshot"]').frameLocator('iframe[title="Payment frame"]').getByText('Paid inside iframe')).toBeVisible()
})

test('picks a locator inside a nested iframe', async ({ page }) => {
  await openTrace(page, 'iframe-trace.zip')
  await page.getByTestId('action').filter({ hasText: 'Fill "Alex Example"' }).click()
  await page.getByRole('button', { name: 'Pick locator' }).click()
  await page.frameLocator('iframe[name="snapshot"]').frameLocator('iframe[title="Payment frame"]').locator('#cardholder').click()

  await expect(page.getByTestId('locator-source')).toHaveText('Snapshot picker')
  await expect(page.getByTestId('locator-value')).toContainText(`.contentFrame().`)
  await expect(page.getByTestId('selector-value')).toHaveText(/ >> internal:control=enter-frame >> #cardholder$/)
})

test('generated popup fixture exposes popup actions', async ({ page }) => {
  await openTrace(page, 'popup-trace.zip')

  await expect(page.getByTestId('action').filter({ hasText: 'Click' })).toHaveCount(2)
  await expect(page.frameLocator('iframe[name="snapshot"]').getByRole('heading', { name: 'Receipt popup' })).toBeVisible()
})

test('console message location cross-links to the network request that served it', async ({ page }) => {
  await openTrace(page, 'popup-trace.zip')

  await page.getByRole('button', { name: /^Console/ }).click()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await expect(page.getByText('popup receipt opened')).toBeVisible()

  await page.getByTestId('console-network-link').click()

  await expect(page.getByTestId('net-detail')).toContainText('receipt.html')
})

test('generated network fixture covers post bodies and error statuses', async ({ page }) => {
  await openTrace(page, 'network-rich-trace.zip')

  await page.getByRole('button', { name: /^Network/ }).click()
  await page.getByRole('button', { name: 'All', exact: true }).click()

  await expect(page.getByTestId('net-row').filter({ hasText: 'checkout' })).toBeVisible()
  await expect(page.getByTestId('net-row').filter({ hasText: 'missing' })).toBeVisible()
  await expect(page.getByTestId('net-row').filter({ hasText: 'error' })).toBeVisible()
  await expect(page.getByText('404')).toBeVisible()
  await expect(page.getByText('500')).toBeVisible()

  await page.getByTestId('net-row').filter({ hasText: 'checkout' }).click()
  await expect(page.getByText('Request body')).toBeVisible()
  await expect(page.getByText('Response body')).toBeVisible()
  await expect(page.getByText('"plan": "Pro"')).toBeVisible()
  await expect(page.getByText('"ok": true')).toBeVisible()
  await expect(page.getByText('x-demo:')).toBeVisible()
  await expect(page.getByText('checkout', { exact: true })).toBeVisible()
})

test('generated console fixture renders typed messages and args', async ({ page }) => {
  await openTrace(page, 'console-rich-trace.zip')

  await page.getByRole('button', { name: /^Console/ }).click()
  await page.getByRole('button', { name: 'All', exact: true }).click()

  await expect(page.getByText('checkout state {step: payment, total: 29}')).toBeVisible()
  await expect(page.getByText('payment latency warning')).toBeVisible()
  await expect(page.getByText('payment failed {code: card_declined}')).toBeVisible()
  await expect(page.getByText('{code: card_declined}', { exact: true })).toBeVisible()
  await expect(page.getByText('warning', { exact: true })).toBeVisible()
  await expect(page.getByText('error', { exact: true })).toBeVisible()
})

test('generated annotations fixture renders trace annotations', async ({ page }) => {
  await openTrace(page, 'annotations-trace.zip')

  await page.getByRole('button', { name: 'Annotations' }).click()
  await expect(page.getByText('issue')).toBeVisible()
  await expect(page.getByRole('link', { name: 'https://kinora.dev/docs/trace-viewer' })).toBeVisible()
  await expect(page.getByText('QA platform team')).toBeVisible()
})
