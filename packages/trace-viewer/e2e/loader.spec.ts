import { expect, test } from '@playwright/test'

test('remembers the detail tab, and ?tab= still wins', async ({ page }) => {
  await page.goto('/?trace=fixtures/demo.zip')
  await expect(page.getByTestId('action').first()).toBeVisible()
  await page.getByRole('button', { name: /^Network/ }).click()

  await page.reload()
  await expect(page.getByTestId('net-row').first()).toBeVisible()

  await page.goto('/?trace=fixtures/demo.zip&tab=call')
  await expect(page.getByTestId('call-title')).toBeVisible()
})

test('pasting a trace zip opens it', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const blob = await (await fetch('fixtures/popup-trace.zip')).blob()
    const data = new DataTransfer()
    data.items.add(new File([blob], 'popup-trace.zip', { type: 'application/zip' }))
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data }))
  })
  await expect(page.getByTestId('action').first()).toBeVisible()
  await expect(page.getByText('popup-trace.zip')).toBeVisible()
})

test('a parent page can load a trace through postMessage once the viewer is ready', async ({ page }) => {
  await page.goto('/')
  const loaded = await page.evaluate(async () => {
    const frame = document.createElement('iframe')
    frame.src = `${location.origin}/`
    frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;background:white;z-index:9999'
    const ready = new Promise<void>((resolve) => {
      window.addEventListener('message', (e) => {
        if (e.source === frame.contentWindow && e.data?.method === 'ready')
          resolve()
      })
    })
    document.body.append(frame)
    await ready
    const trace = await (await fetch('fixtures/demo.zip')).blob()
    frame.contentWindow!.postMessage({ method: 'load', params: { trace } }, '*')
    return true
  })
  expect(loaded).toBe(true)
  await expect(page.frameLocator('iframe').first().getByTestId('action').first()).toBeVisible()
})

test('display canvas content asks the snapshot renderer to paint canvases', async ({ page }) => {
  await page.goto('/?trace=fixtures/demo.zip')
  await expect(page.getByTestId('action').first()).toBeVisible()
  const snapshotUrl = () => page.locator('iframe[name="snapshot"]').evaluate((el: HTMLIFrameElement) => el.contentWindow!.location.href)
  expect(await snapshotUrl()).not.toContain('shouldPopulateCanvasFromScreenshot')

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Display canvas content' }).click()
  await expect.poll(snapshotUrl).toContain('shouldPopulateCanvasFromScreenshot=1')

  await page.reload()
  await expect(page.getByTestId('action').first()).toBeVisible()
  await expect.poll(snapshotUrl).toContain('shouldPopulateCanvasFromScreenshot=1')
})

test('settings switch the theme, shared with the dashboard', async ({ page }) => {
  await page.goto('/?trace=fixtures/demo.zip')
  await expect(page.getByTestId('action').first()).toBeVisible()

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  expect(await page.evaluate(() => localStorage.getItem('kinora-theme'))).toBe('dark')

  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('menuitemradio', { name: 'Light' }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
})

test('a pasted trace replaces ?trace= in the history, and Back reopens the previous one', async ({ page }) => {
  await page.goto('/?trace=fixtures/demo.zip')
  await expect(page.getByText('checkout flow demo')).toBeVisible()
  await page.evaluate(async () => {
    const blob = await (await fetch('fixtures/popup-trace.zip')).blob()
    const data = new DataTransfer()
    data.items.add(new File([blob], 'popup-trace.zip', { type: 'application/zip' }))
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data }))
  })
  await expect(page.getByText('popup-trace.zip')).toBeVisible()
  expect(new URL(page.url()).searchParams.get('trace')).toMatch(/^blob:/)

  await page.goBack()
  await expect(page.getByText('checkout flow demo')).toBeVisible()

  // The in-memory trace is gone after a reload: the drop zone shows instead of a fetch error.
  await page.goForward()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Choose trace.zip' })).toBeVisible()
  await expect(page.getByText('Failed to load trace')).toHaveCount(0)
})

test('a file:// trace URL explains how to open it', async ({ page }) => {
  await page.goto('/?trace=file:///tmp/trace.zip')
  await expect(page.getByTestId('file-url-help')).toBeVisible()
})
