import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  // The bare viewer now shows the drop zone, so the demo trace is explicit.
  await page.goto('/?trace=fixtures/demo.zip')
  // Trace loads asynchronously once the service worker controls the page.
  await expect(page.getByTestId('action').first()).toBeVisible()
})

test('loads the demo trace into the workbench', async ({ page }) => {
  await expect(page.getByText('kinora', { exact: true })).toBeVisible()
  expect(await page.getByTestId('action').count()).toBeGreaterThan(5)
})

test('replays the DOM snapshot in the iframe', async ({ page }) => {
  const frame = page.frameLocator('iframe[name="snapshot"]')
  await expect(frame.getByText('Submitted!')).toBeVisible()
})

test('shows the test source code', async ({ page }) => {
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await expect(page.getByText('@playwright/test').first()).toBeVisible()
})

test('syntax highlights the source', async ({ page }) => {
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  // A duplicate @codemirror/view silently drops highlight decorations, leaving plain monochrome text.
  const tokens = page.locator('.cm-content span')
  await expect(tokens.first()).toBeVisible()
  expect(await tokens.count()).toBeGreaterThan(20)
})

test('network tab lists requests and previews a response body', async ({ page }) => {
  await page.getByRole('button', { name: /^Network/ }).click()
  const rows = page.getByTestId('net-row')
  await expect(rows.first()).toBeVisible()
  await rows.filter({ hasText: 'style.css' }).click()
  await expect(page.getByText('Response body')).toBeVisible()
  await expect(page.getByText('font-family')).toBeVisible()
})

test('network copy menu offers cURL and fetch', async ({ page }) => {
  await page.getByRole('button', { name: /^Network/ }).click()
  await page.getByTestId('net-row').first().click()
  await page.getByRole('button', { name: 'Copy' }).click()
  await expect(page.getByRole('menuitem', { name: 'Copy as cURL' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Copy as fetch' })).toBeVisible()
})

test('attachments tab previews the screenshot', async ({ page }) => {
  await page.getByRole('button', { name: /^Attachments/ }).click()
  await expect(page.getByText('screenshot', { exact: true })).toBeVisible()
  await expect(page.getByText('note', { exact: true })).toBeVisible()
})

test('filmstrip renders screencast frames', async ({ page }) => {
  await expect(page.locator('img[src*="sha1/"]').first()).toBeVisible()
})

test('play advances the selected action', async ({ page }) => {
  const current = page.getByTestId('current-action')
  const before = await current.textContent()
  await page.getByTestId('play').click()
  await expect(page.getByTestId('play')).toHaveAttribute('title', 'Pause')
  await expect(async () => {
    expect(await current.textContent()).not.toBe(before)
  }).toPass({ timeout: 5000 })
  await page.getByTestId('play').click()
  await expect(page.getByTestId('play')).toHaveAttribute('title', 'Play')
})

test('keyboard navigates between actions', async ({ page }) => {
  const current = page.getByTestId('current-action')
  const before = await current.textContent()
  await page.locator('body').press('k')
  await expect(current).not.toHaveText(before ?? '')
})

test('tooltip shows the full url on a truncated network name', async ({ page }) => {
  await page.getByRole('button', { name: /^Network/ }).click()
  const name = page.getByTestId('net-row').first().locator('span').first()
  await name.hover()
  await expect(page.locator('[data-slot="tooltip-content"]').first()).toContainText('demo.test')
})

// The connector seam: the dashboard's "View trace" button opens the viewer with
// ?trace=<hosted zip url>. This proves the viewer loads a trace from that param.
test('loads a trace passed via ?trace=', async ({ page, baseURL }) => {
  const traceUrl = `${baseURL}/fixtures/demo.zip`
  await page.goto(`/?trace=${encodeURIComponent(traceUrl)}`)
  await expect(page.getByTestId('action').first()).toBeVisible()
  expect(await page.getByTestId('action').count()).toBeGreaterThan(5)
})

async function openVideoTrace(page: Page, baseURL: string | undefined): Promise<void> {
  await page.goto(`/?trace=${encodeURIComponent(`${baseURL}/fixtures/video-trace.zip`)}`)
  await expect(page.getByTestId('action').first()).toBeVisible()
  await page.getByRole('button', { name: /^Attachments/ }).click()
}

test('plays a video attachment inline', async ({ page, baseURL }) => {
  await openVideoTrace(page, baseURL)
  const video = page.locator('video')
  await expect(video).toBeVisible()
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(0)
})

// Chromium never routes `<a download>` through the service worker, so downloading from the raw
// sha1 url saves the app's SPA fallback page instead of the attachment.
test('downloads attachment bodies rather than the app shell', async ({ page, baseURL }) => {
  await openVideoTrace(page, baseURL)

  const cases = [
    { contentType: 'video/webm', filename: 'video.webm', magic: '1a45dfa3' },
    { contentType: 'image/png', filename: 'screenshot.png', magic: '89504e47' },
  ]
  for (const { contentType, filename, magic } of cases) {
    const row = page.getByTestId('attachment').filter({ hasText: contentType })
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      row.getByTestId('attachment-download').click(),
    ])
    expect(download.suggestedFilename()).toBe(filename)
    const body = await readFile((await download.path())!)
    expect(body.subarray(0, 4).toString('hex')).toBe(magic)
  }
})

test('opens the tab named by ?tab=', async ({ page, baseURL }) => {
  await page.goto(`/?trace=${encodeURIComponent(`${baseURL}/fixtures/video-trace.zip`)}&tab=attachments`)
  await expect(page.getByTestId('attachment').first()).toBeVisible()
})
