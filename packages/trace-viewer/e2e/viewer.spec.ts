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
  await expect(frame.getByText('Order complete')).toBeVisible()
})

test('shows ARIA snapshot mode empty state', async ({ page }) => {
  await page.getByRole('button', { name: 'ARIA' }).click()
  await expect(page.getByText('No ARIA snapshot captured for this phase')).toBeVisible()
})

test('renders an ARIA snapshot when present', async ({ page }) => {
  await page.goto('/?trace=fixtures/aria-trace.zip')
  await expect(page.getByTestId('action').first()).toBeVisible()
  await page.getByTestId('action').filter({ hasText: 'Click' }).first().click()
  await page.getByRole('button', { name: 'ARIA' }).click()

  await expect(page.getByText('ARIA snapshot', { exact: true })).toBeVisible()
  // The id of the call the snapshot belongs to. Its prefix depends on the Playwright version
  // (`call@57` up to 1.63, a per-run prefix like `cdwd@57` since), so only its shape is checked.
  await expect(page.getByText(/^[\w:]+@\d+$/)).toBeVisible()
  await expect(page.getByText('resources/aria-checkout.yml')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy ARIA' })).toBeVisible()
  await expect(page.getByText('- document:')).toBeVisible()
  await expect(page.getByText('button "Complete checkout"')).toBeVisible()
})

test('shows the test source code', async ({ page }) => {
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await expect(page.getByText(/testInfo\.attach\('screenshot'/)).toBeVisible()
})

test('locator tab shows the selected action locator', async ({ page }) => {
  await page.getByTestId('action').filter({ hasText: 'Fill "alex@example.com"' }).click()
  await page.getByRole('button', { name: 'Locator', exact: true }).click()

  await expect(page.getByTestId('locator-source')).toHaveText('Selected action')
  await expect(page.getByTestId('locator-value')).toContainText(/locator\('#customer'\)/)
  await expect(page.getByTestId('selector-value')).toHaveText('#customer')
  await expect(page.getByRole('button', { name: 'Copy locator' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy selector' })).toBeVisible()
})

test('call tab highlights action details', async ({ page }) => {
  await page.getByTestId('action').filter({ hasText: 'Fill "alex@example.com"' }).click()
  await page.getByRole('button', { name: 'Call', exact: true }).click()

  await expect(page.getByTestId('call-title')).toHaveText('Fill "alex@example.com"')
  await expect(page.getByTestId('call-method')).toHaveText('Frame.fill')
  await expect(page.getByText('Key details')).toBeVisible()
  await expect(page.getByText('selector')).toBeVisible()
  await expect(page.getByText('#customer', { exact: true })).toBeVisible()
  await expect(page.getByText('alex@example.com', { exact: true })).toBeVisible()
})

test('call tab formats expect details', async ({ page }) => {
  await page.getByTestId('action').filter({ hasText: 'Expect "toHaveText"' }).first().click()
  await page.getByRole('button', { name: 'Call', exact: true }).click()

  await expect(page.getByTestId('call-title')).toHaveText('Expect "toHaveText"')
  await expect(page.getByText('expected text')).toBeVisible()
  await expect(page.getByText('Order complete', { exact: true })).toBeVisible()
})

test('picks a locator from the snapshot', async ({ page }) => {
  await page.getByRole('button', { name: 'Pick locator' }).click()
  await page.frameLocator('iframe[name="snapshot"]').getByRole('button', { name: 'Complete checkout' }).click()

  await expect(page.getByRole('button', { name: 'Locator', exact: true })).toHaveClass(/text-foreground/)
  await expect(page.getByTestId('locator-source')).toHaveText('Snapshot picker')
  await expect(page.getByTestId('locator-value')).toContainText(/getByRole\('button', \{ name: 'Complete checkout' \}\)/)
  await expect(page.getByTestId('selector-value')).toHaveText('#complete')
})

test('syntax highlights the source', async ({ page }) => {
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  // A duplicate @codemirror/view silently drops highlight decorations, leaving plain monochrome text.
  const tokens = page.locator('.cm-content span')
  await expect(tokens.first()).toBeVisible()
  expect(await tokens.count()).toBeGreaterThan(20)
})

test('action group filters hide noisy actions', async ({ page }) => {
  const before = await page.getByTestId('action').count()
  await page.getByRole('button', { name: 'Filter actions' }).click()
  await page.getByRole('menuitemcheckbox', { name: /Network routes/ }).click()

  await expect(page.getByText('4 hidden')).toBeVisible()
  expect(await page.getByTestId('action').count()).toBe(before - 4)
})

test('timeline hover shows action details', async ({ page }) => {
  await page.locator('[data-testid="action-segment"][aria-label*=\'Fill "alex@example.com"\']').hover()

  await expect(page.getByTestId('timeline-hover-card')).toContainText('Fill "alex@example.com"')
  await expect(page.getByTestId('timeline-hover-card')).toContainText(/\d+ms/)
})

test('timeline cursor follows clicked segments', async ({ page }) => {
  await page.locator('[data-testid="action-segment"][aria-label*=\'Fill "alex@example.com"\']').click()

  await expect(page.getByTestId('current-action')).toContainText('Fill "alex@example.com"')
  await expect(page.getByTestId('timeline-cursor')).toBeVisible()
  await expect(page.getByTestId('timeline-current-time')).toContainText(/\d+ms/)
})

test('timeline brush stays visible while selecting a range', async ({ page }) => {
  const box = await page.getByTestId('timeline-track').boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + 20, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + 140, box!.y + box!.height / 2)

  await expect(page.getByTestId('timeline-brush')).toBeVisible()

  await page.mouse.up()
})

test('double-clicking an action zooms to its time range', async ({ page }) => {
  await page.getByTestId('action').filter({ hasText: 'Fill "alex@example.com"' }).dblclick()
  await expect(page.getByTestId('reset-zoom')).toBeVisible()
  await expect(page.getByTestId('reset-zoom')).toContainText(/\d+ms - \d+ms/)
})

test('network tab lists requests and previews a response body', async ({ page }) => {
  await page.getByRole('button', { name: /^Network/ }).click()
  const rows = page.getByTestId('net-row')
  await expect(rows.first()).toBeVisible()
  await rows.filter({ hasText: 'style.css' }).click()
  await expect(page.getByText('Response body')).toBeVisible()
  await expect(page.getByText('font-family')).toBeVisible()
})

test('network tab can show all requests in the trace', async ({ page }) => {
  await page.getByTestId('action').first().click()
  await page.getByRole('button', { name: /^Network/ }).click()
  await expect(page.getByText('No network for this action')).toBeVisible()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await expect(page.getByTestId('net-row').filter({ hasText: 'style.css' })).toBeVisible()
})

test('network copy menu offers cURL and fetch', async ({ page }) => {
  await page.getByRole('button', { name: /^Network/ }).click()
  await page.getByTestId('net-row').first().click()
  await page.getByRole('button', { name: 'Copy' }).click()
  await expect(page.getByRole('menuitem', { name: 'Copy as cURL' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Copy as fetch' })).toBeVisible()
})

test('console tab can show all messages in the trace', async ({ page }) => {
  await page.getByTestId('action').first().click()
  await page.getByRole('button', { name: /^Console/ }).click()
  await expect(page.getByText('No console output for this action')).toBeVisible()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await expect(page.getByText('order submitted, customer = alex@example.com')).toBeVisible()
  await expect(page.getByText('demo warning from checkout flow')).toBeVisible()
})

test('attachments tab previews the screenshot', async ({ page }) => {
  await page.getByRole('button', { name: /^Attachments/ }).click()
  await expect(page.getByText('screenshot', { exact: true })).toBeVisible()
  await expect(page.getByText('note', { exact: true })).toBeVisible()
})

test('metadata tab shows trace environment details', async ({ page }) => {
  await page.getByRole('button', { name: 'Metadata' }).click()
  await expect(page.getByRole('heading', { name: 'Browser' })).toBeVisible()
  await expect(page.getByText('playwright version')).toBeVisible()
  await expect(page.getByText(/\d+\.\d+\.\d+/).first()).toBeVisible()
  await expect(page.getByRole('cell', { name: 'actions' })).toBeVisible()
})

test('annotations tab shows the empty state', async ({ page }) => {
  await page.getByRole('button', { name: 'Annotations' }).click()
  await expect(page.getByText('No annotations')).toBeVisible()
})

test('filmstrip renders screencast frames', async ({ page }) => {
  await expect(page.locator('img[src*="file/"]').first()).toBeVisible()
})

test('opens the current snapshot in a new tab', async ({ page }) => {
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: 'Open snapshot in new tab' }).click(),
  ])

  await expect(popup).toHaveURL(/\/snapshot\//)
  await expect(popup.getByText('Order complete')).toBeVisible()
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

test('cycles playback speed and scrubs actions', async ({ page }) => {
  await expect(page.getByTestId('playback-speed')).toHaveText('1x')
  await page.getByTestId('playback-speed').click()
  await expect(page.getByTestId('playback-speed')).toHaveText('2x')

  await page.getByTestId('action-scrubber').fill('0')
  await expect(page.getByTestId('current-action')).toContainText('Before Hooks')
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
  await expect(page.locator('[data-slot="tooltip-content"]').first()).toContainText('demo.kinora.dev')
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

// Chromium never routes `<a download>` through the service worker, so fetch the body first.
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
