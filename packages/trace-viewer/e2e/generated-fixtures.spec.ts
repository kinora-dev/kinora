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

test('failed requests read red, and a selection hidden by a filter does not come back', async ({ page }) => {
  await openTrace(page, 'network-rich-trace.zip')
  await page.getByRole('button', { name: /^Network/ }).click()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await expect(page.locator('[data-testid="net-row"][data-failed]')).toHaveCount(2)
  await expect(page.getByTestId('net-row').filter({ hasText: 'cart' })).not.toHaveAttribute('data-failed')

  await page.getByTestId('net-row').filter({ hasText: 'cart' }).click()
  await expect(page.getByTestId('net-detail')).toBeVisible()
  await page.getByPlaceholder(/^Search/).fill('missing')
  await expect(page.getByTestId('net-detail')).toHaveCount(0)
  await page.getByPlaceholder(/^Search/).fill('')
  await expect(page.getByTestId('net-row')).toHaveCount(4)
  await expect(page.getByTestId('net-detail')).toHaveCount(0)
})

test('attachments are split into image diff, screenshots and collapsed text attachments', async ({ page }) => {
  await page.goto('/?trace=fixtures/image-diff-trace.zip&tab=attachments')
  await expect(page.getByTestId('attachments-section')).toHaveText(['Image diff', 'Attachments'])

  // Image diff: sizes, the three files, and the side-by-side toggle to the diff.
  await page.getByRole('button', { name: 'Side by side' }).click()
  await expect(page.getByText('Expected 240 × 120')).toBeVisible()
  await page.getByTestId('sxs-right').click()
  await expect(page.getByText('Diff 240 × 120')).toBeVisible()
  await expect(page.getByTestId('image-diff-file')).toHaveText(['plan-card-expected.png', 'plan-card-actual.png', 'plan-card-diff.png'])

  // Text attachments load only when opened.
  const context = page.getByTestId('attachment').filter({ hasText: 'error-context' })
  await expect(context.getByTestId('attachment-text')).toHaveCount(0)
  await context.getByTestId('attachment-toggle').click()
  await expect(context.getByTestId('attachment-text')).toContainText('# Instructions')
})

test('screenshots get their own section with an open link', async ({ page }) => {
  await page.goto('/?trace=fixtures/demo.zip&tab=attachments')
  await expect(page.getByTestId('attachments-section')).toHaveText(['Screenshots', 'Attachments'])
  await expect(page.getByTestId('attachment').filter({ hasText: 'screenshot' }).getByTestId('attachment-open')).toHaveAttribute('target', '_blank')
})

test('arrow keys walk the network requests and Escape closes the details', async ({ page }) => {
  await openTrace(page, 'network-rich-trace.zip')
  await page.getByRole('button', { name: /^Network/ }).click()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await page.getByTestId('net-row').filter({ hasText: 'cart' }).click()
  const selectedAction = await page.getByTestId('current-action').textContent()

  await page.keyboard.press('ArrowDown')
  await expect(page.locator('[data-testid="net-row"][data-selected]')).toContainText('checkout')
  await expect(page.getByTestId('net-detail').getByTestId('net-section-general')).toContainText('/api/checkout')
  // The action list keeps its selection.
  await expect(page.getByTestId('current-action')).toHaveText(selectedAction ?? '')

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('net-detail')).toHaveCount(0)
})

test('a WebSocket shows its frames with direction, opcode and a decoded detail', async ({ page }) => {
  await openTrace(page, 'websocket-trace.zip')
  await page.getByRole('button', { name: /^Network/ }).click()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await page.getByTestId('net-row').filter({ hasText: 'prices' }).click()

  const detail = page.getByTestId('net-detail')
  await expect(detail.getByTestId('net-tab-payload')).toHaveCount(0)
  await expect(detail.getByTestId('ws-message')).toHaveCount(4)
  await expect(detail.getByTestId('ws-message').first()).toContainText('pro')

  await detail.getByTestId('ws-message').filter({ hasText: 'binary' }).click()
  await expect(detail.getByTestId('ws-message-detail')).toContainText('Received · Binary · 6 B')
  await expect(detail.getByTestId('ws-message-detail')).toContainText('ca fe ba be 00 01')

  await page.keyboard.press('ArrowUp')
  await expect(detail.getByTestId('ws-message-detail')).toContainText('"currency": "USD"')
})

test('a console link to a request applies once, not on every visit to the Network tab', async ({ page }) => {
  await openTrace(page, 'network-rich-trace.zip')
  await page.getByRole('button', { name: /^Console/ }).click()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await page.getByTestId('console-network-link').first().click()
  await expect(page.getByTestId('net-detail')).toBeVisible()

  // The link widened the list to the whole trace; narrow it again and zoom the timeline.
  await page.getByRole('button', { name: 'Selected', exact: true }).click()
  await page.getByTestId('action').last().dblclick()
  await expect(page.getByTestId('reset-zoom')).toBeVisible()

  await page.getByRole('button', { name: /^Call/ }).click()
  await page.getByRole('button', { name: /^Network/ }).click()
  await expect(page.getByTestId('reset-zoom')).toBeVisible()
  await page.getByTestId('reset-zoom').click()
  await expect(page.getByRole('button', { name: 'Selected', exact: true })).toHaveClass(/bg-card/)
})

test('hovering an action keeps the open network request', async ({ page }) => {
  await openTrace(page, 'network-rich-trace.zip')
  await page.getByTestId('action').last().click()
  await page.getByRole('button', { name: /^Network/ }).click()
  await page.getByTestId('net-row').filter({ hasText: 'checkout' }).click()
  await expect(page.getByTestId('net-detail')).toBeVisible()

  await page.getByTestId('action').first().hover()
  await page.getByTestId('net-detail').hover()
  await expect(page.getByTestId('net-detail')).toContainText('/api/checkout')
})

test('the selected step lists what the page logged inside it', async ({ page }) => {
  await openTrace(page, 'step-console-trace.zip')
  await page.getByTestId('action').filter({ hasText: 'checkout step' }).click()
  await page.getByRole('button', { name: /^Console/ }).click()

  const bodies = page.getByTestId('console-body')
  await expect(bodies.filter({ hasText: 'clicked in step' })).toBeVisible()
  await expect(bodies.filter({ hasText: 'warned in step' })).toBeVisible()
  await expect(bodies.filter({ hasText: 'runner line in step' })).toBeVisible()
})
