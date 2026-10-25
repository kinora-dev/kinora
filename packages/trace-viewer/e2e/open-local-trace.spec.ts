import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const DEMO_ZIP = fileURLToPath(new URL('../public/fixtures/demo.zip', import.meta.url))

test('shows the drop zone when no trace is requested', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Open a Playwright trace' })).toBeVisible()
  await expect(page.getByTestId('action')).toHaveCount(0)
})

test('opens a trace picked from disk, without uploading it', async ({ page }) => {
  const uploads: string[] = []
  await page.route('**/*', async (route) => {
    const req = route.request()
    if (req.method() === 'POST' || req.method() === 'PUT')
      uploads.push(req.url())
    await route.continue()
  })

  await page.goto('/')
  await page.getByTestId('trace-file-input').setInputFiles(DEMO_ZIP)

  await expect(page.getByTestId('action').first()).toBeVisible()
  expect(await page.getByTestId('action').count()).toBeGreaterThan(5)
  // The file name replaces the trace title in the header.
  await expect(page.getByText('demo.zip')).toBeVisible()
  // The trace is read through a blob: URL, so it never leaves the browser.
  expect(uploads).toEqual([])
})

test('replays the snapshot of a trace opened from disk', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('trace-file-input').setInputFiles(DEMO_ZIP)
  await expect(page.getByTestId('action').first()).toBeVisible()

  const frame = page.frameLocator('iframe[name="snapshot"]')
  await expect(frame.getByText('Order complete')).toBeVisible()
})

test('falls back to the demo trace from the drop zone', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('open-demo').click()
  await expect(page.getByTestId('action').first()).toBeVisible()
})

test('Back returns to the drop zone and Forward reopens the dropped trace', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('trace-file-input').setInputFiles(DEMO_ZIP)
  await expect(page.getByTestId('action').first()).toBeVisible()

  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Open a Playwright trace' })).toBeVisible()
  await page.goForward()
  await expect(page.getByTestId('action').first()).toBeVisible()
  await expect(page.getByText('demo.zip')).toBeVisible()
})

test('a trace dragged over the snapshot lands on the drop overlay', async ({ page }) => {
  await page.goto('/?trace=fixtures/demo.zip')
  await expect(page.getByTestId('action').first()).toBeVisible()
  const snapshot = (await page.locator('iframe[name="snapshot"]').boundingBox())!

  const zip = await (await page.request.get('/fixtures/demo.zip')).body()
  const transfer = await page.evaluateHandle((bytes) => {
    const data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], 'dragged.zip', { type: 'application/zip' }))
    return data
  }, [...zip])
  await page.dispatchEvent('header', 'dragenter', { dataTransfer: transfer })
  const target = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('data-testid'), { x: snapshot.x + snapshot.width / 2, y: snapshot.y + snapshot.height / 2 })
  expect(target).toBe('drop-overlay')

  await page.getByTestId('drop-overlay').dispatchEvent('drop', { dataTransfer: transfer })
  await expect(page.getByText('dragged.zip')).toBeVisible()
  await expect(page.getByTestId('drop-overlay')).toHaveCount(0)
})
