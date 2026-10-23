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
