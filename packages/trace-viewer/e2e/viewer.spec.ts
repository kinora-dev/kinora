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

test('hides the ARIA toggle when the trace has no ARIA snapshots', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'DOM', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'ARIA', exact: true })).toHaveCount(0)
})

test('renders a recorded ARIA snapshot as YAML', async ({ page }) => {
  await page.goto('/?trace=fixtures/aria-trace.zip')
  await expect(page.getByTestId('action').first()).toBeVisible()
  await page.getByTestId('action').filter({ hasText: 'Click' }).first().click()
  await page.getByRole('button', { name: 'ARIA' }).click()

  await expect(page.getByText('ARIA snapshot', { exact: true })).toBeVisible()
  // The id of the call the snapshot belongs to. Its prefix depends on the Playwright version
  // (`call@57` up to 1.63, a per-run prefix like `cdwd@57` since), so only its shape is checked.
  await expect(page.getByText(/^[\w:]+@\d+$/)).toBeVisible()
  await expect(page.getByText(/^aria\/[\w:]+@\d+-action\.json$/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy ARIA' })).toBeVisible()

  // Playwright 1.63+ records the snapshot as JSON; it must not reach the user raw.
  const snapshot = page.getByTestId('aria-snapshot')
  await expect(snapshot).not.toContainText('"role"')
  await expect(snapshot).toContainText('- main:')
  await expect(snapshot).toContainText('- heading "Checkout" [level=1]')
  await expect(snapshot).toContainText('- button "Complete checkout"')
  await expect(snapshot).not.toContainText('[box=')
})

test('remembers ARIA mode across reloads', async ({ page }) => {
  await page.goto('/?trace=fixtures/aria-trace.zip')
  await page.getByRole('button', { name: 'ARIA', exact: true }).click()
  await expect(page.getByTestId('aria-snapshot')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('aria-snapshot')).toBeVisible()
  await page.getByRole('button', { name: 'DOM', exact: true }).click()
  await expect(page.getByTestId('aria-snapshot')).toHaveCount(0)
})

test('opens an ARIA-only trace in ARIA mode with the screenshot and action overlays', async ({ page }) => {
  await page.goto('/?trace=fixtures/aria-only-trace.zip')
  await page.getByTestId('action').filter({ hasText: 'Click' }).first().click()

  // No DOM snapshots: ARIA is the only mode, so there is nothing to toggle.
  await expect(page.getByRole('button', { name: 'ARIA', exact: true })).toHaveCount(0)
  await expect(page.getByTestId('aria-snapshot')).toContainText('- button "Complete checkout"')
  await expect(page.getByTestId('aria-screenshot')).toBeVisible()
  await expect(page.getByTestId('aria-action-point')).toBeVisible()
  const actionBox = await page.getByTestId('aria-action-box').boundingBox()

  // The clicked button's line highlights the same area as the action box.
  await page.getByTestId('aria-line').filter({ hasText: 'button "Complete checkout"' }).hover()
  const hovered = await page.getByTestId('aria-hovered-box').boundingBox()
  expect(actionBox && hovered).toBeTruthy()
  for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(Math.abs(hovered![key] - actionBox![key])).toBeLessThan(2)

  await page.getByRole('button', { name: 'After', exact: true }).click()
  await expect(page.getByTestId('aria-phase')).toHaveText('after')
  await expect(page.getByTestId('aria-action-box')).toHaveCount(0)
})

test('falls back to the after ARIA snapshot when an action has no action phase', async ({ page }) => {
  await page.goto('/?trace=fixtures/aria-only-trace.zip')
  await page.getByTestId('action').filter({ hasText: 'Set content' }).first().click()
  await expect(page.getByTestId('aria-phase')).toHaveText('after')
  await expect(page.getByTestId('aria-snapshot')).toContainText('- heading "Checkout" [level=1]')
})

test('shows the test source code', async ({ page }) => {
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await expect(page.getByText(/testInfo\.attach\('screenshot'/)).toBeVisible()
})

test('source tab toolbar names the file and copies it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByTestId('action').filter({ hasText: 'Fill "alex@example.com"' }).click()
  await page.getByRole('button', { name: 'Source', exact: true }).click()

  await expect(page.getByTestId('source-file-name')).toHaveText('demo.spec.ts')
  await expect(page.getByTestId('source-file-name')).toHaveAttribute('title', /\/demo\.spec\.ts$/)
  // A single frame has nothing to pick from, so the frame list stays hidden.
  await expect(page.getByTestId('stack-frames')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open in VS Code' })).toBeVisible()

  await page.getByRole('button', { name: 'Copy filename' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('demo.spec.ts')
})

test('source tab opens the frame through the desktop app', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __opened: unknown[], __kinoraDesktop: unknown }
    w.__opened = []
    w.__kinoraDesktop = {
      openInEditor: async (file: string, line: number, column: number) => {
        w.__opened.push([file, line, column])
        return w.__opened.length > 1 ? { error: `${file} is not on this machine` } : {}
      },
    }
  })
  await page.reload()
  await page.getByTestId('action').filter({ hasText: 'Fill "alex@example.com"' }).click()
  await page.getByRole('button', { name: 'Source', exact: true }).click()

  const open = page.getByRole('button', { name: 'Open in editor' })
  await open.click()
  const [[file, line, column]] = await page.evaluate(() => (window as unknown as { __opened: [string, number, number][] }).__opened)
  expect(file).toMatch(/\/demo\.spec\.ts$/)
  expect(line).toBeGreaterThan(0)
  expect(column).toBeGreaterThan(0)
  await expect(page.getByTestId('open-in-editor-error')).toHaveCount(0)

  await open.click()
  await expect(page.getByTestId('open-in-editor-error')).toContainText('is not on this machine')
})

test('source tab annotates the failing line of a library trace', async ({ page }) => {
  await page.goto('/?trace=fixtures/library-error-trace.zip')
  await page.getByTestId('action').filter({ hasText: 'Click' }).first().click()
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await expect(page.locator('.cm-errorLine')).toHaveCount(1)
  await expect(page.locator('.cm-errorMessage')).toContainText('Timeout 500ms exceeded')
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
  // The selector reads as a locator in the trace's language, like upstream's Call tab.
  await expect(page.getByRole('cell', { name: 'locator', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: `locator('#customer')`, exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'alex@example.com', exact: true })).toBeVisible()
  await expect(page.getByTestId('call-start')).toHaveText(/^\d+(?:\.\d)?m?s$/)
  await expect(page.getByTestId('call-duration')).toHaveText(/^\d+(?:\.\d)?m?s$/)
})

test('call tab copies a single value', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByTestId('action').filter({ hasText: 'Fill "alex@example.com"' }).click()
  await page.getByRole('button', { name: 'Call', exact: true }).click()
  const row = page.getByTestId('call-row').filter({ hasText: 'locator' })
  await row.hover()
  await row.getByRole('button', { name: 'Copy locator' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`locator('#customer')`)
})

test('log tab shows how long each step took', async ({ page }) => {
  await page.getByTestId('action').filter({ hasText: 'Click' }).first().click()
  await page.getByRole('button', { name: 'Log', exact: true }).click()
  await expect(page.getByTestId('log-line').first()).toBeVisible()
  await expect(page.getByTestId('log-duration').first()).toHaveText(/^\d+(?:\.\d)?m?s$/)
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

test('remembers hidden action groups across reloads', async ({ page }) => {
  const before = await page.getByTestId('action').count()
  await page.getByRole('button', { name: 'Filter actions' }).click()
  await page.getByRole('menuitemcheckbox', { name: /Network routes/ }).click()
  await expect(page.getByText('4 hidden')).toBeVisible()

  await page.reload()
  await expect(page.getByTestId('action').first()).toBeVisible()
  await expect(page.getByText('4 hidden')).toBeVisible()
  expect(await page.getByTestId('action').count()).toBe(before - 4)

  await page.getByRole('button', { name: 'Filter actions' }).click()
  await expect(page.getByRole('menuitemcheckbox', { name: /Network routes/ })).toHaveAttribute('aria-checked', 'false')
})

test('marks requests a route handled', async ({ page }) => {
  await page.getByRole('button', { name: /^Network/ }).click()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  const routed = page.locator('[data-testid="net-row"][data-route="fulfilled"]')
  await expect(routed.first()).toBeVisible()
  await expect(routed.first()).toContainText('fulfilled')
})

test('shows how a route handled a request in the network detail', async ({ page }) => {
  await page.getByRole('button', { name: /^Network/ }).click()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await page.locator('[data-testid="net-row"][data-route="fulfilled"]').first().click()

  const detail = page.getByTestId('net-detail')
  await expect(detail.getByText('Route', { exact: true })).toBeVisible()
  await expect(detail.getByText('fulfilled', { exact: true })).toBeVisible()
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

test('network list shows content type and start columns', async ({ page }) => {
  await page.getByRole('button', { name: /^Network/ }).click()
  const headers = page.locator('thead th[data-col]')
  await expect(headers).toHaveText(['Name', 'Method', 'Status', 'Content Type', 'Duration', 'Size', 'Start', 'Route'])
  const css = page.getByTestId('net-row').filter({ hasText: 'style.css' })
  await expect(css.locator('[data-col="contentType"]')).toHaveText('text/css')
  await expect(css.locator('[data-col="start"]')).toHaveText(/^\d+ms$/)
})

test('network columns resize and keep their width', async ({ page }) => {
  await page.getByRole('button', { name: /^Network/ }).click()
  const name = page.locator('thead th').filter({ hasText: 'Name' })
  const before = (await name.boundingBox())!.width
  const handle = (await name.getByTestId('net-col-resizer').boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + 120, handle.y + handle.height / 2, { steps: 5 })
  await page.mouse.up()
  // The column follows the pointer one-to-one.
  const moved = 120 - handle.width / 2
  await expect.poll(async () => Math.abs((await name.boundingBox())!.width - before - moved)).toBeLessThanOrEqual(2)

  const resized = (await name.boundingBox())!.width
  await page.reload()
  await page.getByRole('button', { name: /^Network/ }).click()
  await expect.poll(async () => Math.abs((await page.locator('thead th').filter({ hasText: 'Name' }).boundingBox())!.width - resized)).toBeLessThanOrEqual(2)
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

test('console and network times are relative to the trace start', async ({ page }) => {
  const parseMs = (label: string | null): number => {
    const m = label?.trim().match(/^([\d.]+)(ms|s)$/)
    expect(m, `unexpected time label "${label}"`).toBeTruthy()
    return Number(m![1]) * (m![2] === 's' ? 1000 : 1)
  }
  const actionStart = async (title: string): Promise<number> => {
    await page.getByTestId('action').filter({ hasText: title }).first().click()
    return parseMs(await page.getByTestId('timeline-current-time').textContent())
  }
  const fillStart = await actionStart('Fill')
  const nextStart = await actionStart('toHaveText')
  const clickStart = await actionStart('Click')

  // The demo logs to the console during the click, so its time sits between the two action starts.
  await page.getByRole('button', { name: /^Console/ }).click()
  const consoleTime = parseMs(await page.getByTestId('console-time').first().textContent())
  expect(consoleTime).toBeGreaterThanOrEqual(clickStart - 1)
  expect(consoleTime).toBeLessThanOrEqual(nextStart + 1)

  // style.css is fetched by the page before the form is filled.
  await page.getByRole('button', { name: /^Network/ }).click()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await page.getByTestId('net-row').filter({ hasText: 'style.css' }).click()
  expect(parseMs(await page.getByTestId('net-started').textContent())).toBeLessThanOrEqual(fillStart + 1)
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
  await page.goto('/?trace=fixtures/video-trace.zip')
  await expect(page.getByTestId('action').first()).toBeVisible()
  await page.getByTestId('action-scrubber').fill('0')
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
  await page.getByTestId('playback-speed').click()
  await expect(page.getByTestId('playback-speed')).toHaveText('0.25x')
  await page.getByTestId('playback-speed').click()
  await expect(page.getByTestId('playback-speed')).toHaveText('0.5x')

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
