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
  await expect(page.getByTestId('locator-value')).toHaveText(`locator('iframe[title="Payment frame"]').contentFrame().getByRole('textbox', { name: 'Card holder' })`)
  await expect(page.getByTestId('selector-value')).toHaveText('iframe[title="Payment frame"] >> internal:control=enter-frame >> internal:role=textbox[name="Card holder"i]')
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
  const detail = page.getByTestId('net-detail')
  await expect(detail.getByTestId('net-section-response-headers')).toContainText('x-demo')
  await expect(detail.getByTestId('net-section-general')).toContainText('/api/checkout')

  await detail.getByTestId('net-tab-payload').click()
  await expect(detail.getByText('Request body')).toBeVisible()
  await expect(detail.getByTestId('net-request-body')).toContainText('"plan": "Pro"')

  await detail.getByTestId('net-tab-response').click()
  await expect(detail.getByText('Response body')).toBeVisible()
  await expect(detail.getByTestId('net-response-body')).toContainText('"ok": true')
})

test('network detail copies the request as Playwright code', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openTrace(page, 'network-rich-trace.zip')
  await page.getByRole('button', { name: /^Network/ }).click()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await page.getByTestId('net-row').filter({ hasText: 'checkout' }).click()

  await page.getByTestId('net-detail').getByRole('button', { name: 'Copy' }).click()
  await page.getByRole('menuitem', { name: 'Copy as Playwright' }).click()
  // The copy is async (bodies stored as files are fetched first).
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toBe('')
  const code = await page.evaluate(() => navigator.clipboard.readText())
  expect(code).toContain(`await page.request.post('https://demo.kinora.dev/api/checkout'`)
  expect(code).toContain(`"plan":"Pro"`)
  expect(code).toContain(`'content-type': 'application/json'`)
})

test('network detail copies the request as cURL without transport headers', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openTrace(page, 'network-rich-trace.zip')
  await page.getByRole('button', { name: /^Network/ }).click()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await page.getByTestId('net-row').filter({ hasText: 'checkout' }).click()

  await page.getByTestId('net-detail').getByRole('button', { name: 'Copy' }).click()
  await page.getByRole('menuitem', { name: 'Copy as cURL' }).click()
  // The copy is async (bodies stored as files are fetched first).
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toBe('')
  const command = await page.evaluate(() => navigator.clipboard.readText())
  expect(command).toContain(`curl 'https://demo.kinora.dev/api/checkout'`)
  expect(command).toContain(`"plan":"Pro"`)
  expect(command.toLowerCase()).not.toContain('accept-encoding')
  expect(command.toLowerCase()).not.toContain('-h \'host:')
})

test('network detail toggles pretty printing and remembers its tab', async ({ page }) => {
  await openTrace(page, 'network-rich-trace.zip')
  await page.getByRole('button', { name: /^Network/ }).click()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await page.getByTestId('net-row').filter({ hasText: 'checkout' }).click()
  const detail = page.getByTestId('net-detail')
  await detail.getByTestId('net-tab-payload').click()
  await expect(detail.getByTestId('net-request-body')).toContainText('"plan": "Pro"')

  await detail.getByRole('button', { name: 'Pretty print' }).click()
  await expect(detail.getByTestId('net-request-body')).toContainText('"plan":"Pro"')

  // Another request opens on the same tab, a GET without body says so.
  await page.getByTestId('net-row').filter({ hasText: 'cart' }).click()
  await expect(detail.getByText('No payload for this request.')).toBeVisible()

  await detail.getByRole('button', { name: 'Close' }).click()
  await expect(detail).toHaveCount(0)
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

test('console shows runner output, formatting, repeats and page errors', async ({ page }) => {
  await openTrace(page, 'console-format-trace.zip')
  await page.getByRole('button', { name: /^Console/ }).click()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  const entry = (text: string) => page.getByTestId('console-entry').filter({ hasText: text })

  // Runner stdio sits next to page messages, so every line says where it came from.
  await expect(entry('runner ready').getByTestId('console-source')).toHaveText('test')
  // `\x1b[32m` renders in the theme's green.
  const pass = await page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('span'))
    probe.style.color = 'var(--pass)'
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  })
  await expect(entry('runner ready').getByTestId('console-body').locator('span')).toHaveCSS('color', pass)
  await expect(entry('runner warning on stderr')).toHaveAttribute('data-level', 'error')
  await expect(entry('repeated message').getByTestId('console-source')).toHaveText('page#1')

  const styled = entry('styled').getByTestId('console-body').locator('span').first()
  await expect(styled).toHaveText('styled')
  await expect(styled).toHaveCSS('color', 'rgb(255, 0, 0)')
  await expect(styled).toHaveCSS('font-weight', '700')
  await expect(entry('styled').getByTestId('console-body')).toHaveText('styled plain value')

  await expect(entry('repeated message')).toHaveCount(1)
  await expect(entry('repeated message').getByTestId('console-repeat')).toHaveText('3')

  await expect(entry('boom from page')).toContainText('page error')
  await expect(entry('boom from page').getByTestId('console-stack')).toContainText('Error: boom from page')

  await entry('repeated message').click()
  await expect(page.getByTestId('current-action')).toHaveText('Click')
})

test('generated annotations fixture renders trace annotations', async ({ page }) => {
  await openTrace(page, 'annotations-trace.zip')

  await page.getByRole('button', { name: 'Annotations' }).click()
  await expect(page.getByText('issue')).toBeVisible()
  await expect(page.getByRole('link', { name: 'https://kinora.dev/docs/trace-viewer' })).toBeVisible()
  await expect(page.getByText('QA platform team')).toBeVisible()
})
