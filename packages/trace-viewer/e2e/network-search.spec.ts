import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?trace=fixtures/demo.zip')
  await expect(page.getByTestId('action').first()).toBeVisible()
})

test('network search finds text in response bodies and headers', async ({ page }) => {
  await page.getByRole('button', { name: /^Network/ }).click()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  const filter = page.getByPlaceholder('Search URLs, headers, bodies')

  await filter.fill('box-sizing')
  const rows = page.getByTestId('net-row')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('style.css')
  await expect(rows.first().getByTestId('net-match')).toHaveText('response body')

  await filter.fill('content-length')
  await expect(rows).toHaveCount(2)
  await expect(rows.first().getByTestId('net-match')).toHaveText('headers')

  await page.getByRole('button', { name: 'Search in' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Headers' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByText('No network in this trace')).toBeVisible()

  await page.reload()
  await expect(page.getByTestId('action').first()).toBeVisible()
  await page.getByRole('button', { name: /^Network/ }).click()
  await page.getByRole('button', { name: 'Search in' }).click()
  await expect(page.getByRole('menuitemcheckbox', { name: 'Headers' })).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByRole('menuitemcheckbox', { name: 'Response body' })).toHaveAttribute('aria-checked', 'true')
})

test('network search finds a request body stored as a trace file', async ({ page }) => {
  await page.goto('/?trace=fixtures/network-rich-trace.zip')
  await expect(page.getByTestId('action').first()).toBeVisible()
  await page.getByRole('button', { name: /^Network/ }).click()
  await page.getByRole('button', { name: 'All', exact: true }).click()

  await page.getByPlaceholder('Search URLs, headers, bodies').fill('"plan":"Pro"')
  const row = page.getByTestId('net-row').filter({ hasText: 'checkout' })
  await expect(row).toBeVisible()
  await expect(row.getByTestId('net-match').filter({ hasText: 'request body' })).toBeVisible()
})
