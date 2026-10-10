import { expect, test } from '@playwright/test'

// Every other spec replays a committed fixture, recorded by whichever Playwright generated it.
// This one records a trace with the Playwright installed right now and opens it, so a Playwright
// upgrade whose trace format the vendored engine cannot read fails here, before users hit
// "the trace was created by a newer version of Playwright".
test('opens a trace recorded by the installed Playwright', async ({ browser, page }, testInfo) => {
  const tracePath = testInfo.outputPath('live-trace.zip')
  const recorded = await browser.newContext()
  await recorded.tracing.start({ screenshots: true, snapshots: true })
  const recordedPage = await recorded.newPage()
  await recordedPage.setContent('<main><h1>Checkout</h1><button onclick="this.textContent = \'Paid\'">Pay now</button></main>')
  await recordedPage.getByRole('button', { name: 'Pay now' }).click()
  await expect(recordedPage.getByRole('button', { name: 'Paid' })).toBeVisible()
  await recorded.tracing.stop({ path: tracePath })
  await recorded.close()

  await page.goto('/')
  await page.getByTestId('trace-file-input').setInputFiles(tracePath)

  await expect(page.getByText('Failed to load trace')).toBeHidden()
  await expect(page.getByTestId('action').filter({ hasText: 'Click' }).first()).toBeVisible()
  await page.getByTestId('action').filter({ hasText: 'Click' }).first().click()
  await expect(page.frameLocator('iframe[name="snapshot"]').getByRole('button')).toBeVisible()
})
