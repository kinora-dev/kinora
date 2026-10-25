import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

async function openLocatorTab(page: Page, trace: string, action: string): Promise<void> {
  await page.goto(`/?trace=fixtures/${trace}&isUnderTest`)
  await page.getByTestId('action').filter({ hasText: action }).first().click()
  await page.getByRole('button', { name: 'Locator', exact: true }).click()
}

async function typeLocator(page: Page, text: string): Promise<void> {
  const editor = page.getByTestId('locator-value').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(text)
}

function highlights(page: Page) {
  return page.frameLocator('iframe[name="snapshot"]').locator('x-pw-highlight')
}

test('counts and highlights what the action locator matches', async ({ page }) => {
  await openLocatorTab(page, 'demo.zip', 'Fill "alex@example.com"')
  await expect(page.getByTestId('locator-source')).toHaveText('Selected action')
  await expect(page.getByTestId('locator-matches')).toHaveText(/^1 match/)
  await expect(highlights(page)).toHaveCount(1)
})

test('editing the locator re-resolves it against the snapshot', async ({ page }) => {
  await openLocatorTab(page, 'demo.zip', 'Fill "alex@example.com"')

  await typeLocator(page, `locator('li.step')`)
  await expect(page.getByTestId('locator-source')).toHaveText('Edited')
  await expect(page.getByTestId('locator-matches')).toHaveText(/^3 matches.*strict mode/)
  await expect(page.getByTestId('locator-matches')).toHaveAttribute('data-tone', 'flaky')
  await expect(highlights(page)).toHaveCount(3)
  await expect(page.getByTestId('selector-value')).toHaveText('li.step')

  await typeLocator(page, `getByRole('button', { name: 'Pay later' })`)
  await expect(page.getByTestId('locator-matches')).toHaveText(/^No match.*times out/)
  await expect(highlights(page)).toHaveCount(0)

  await typeLocator(page, `getByRole(`)
  await expect(page.getByTestId('locator-matches')).toHaveText('Invalid locator')

  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(page.getByTestId('locator-source')).toHaveText('Selected action')
  await expect(page.getByTestId('locator-matches')).toHaveText(/^1 match/)
})

test('an edited locator stays while browsing actions', async ({ page }) => {
  await openLocatorTab(page, 'demo.zip', 'Fill "alex@example.com"')
  await typeLocator(page, `getByRole('heading', { name: 'Order complete' })`)
  await expect(page.getByTestId('locator-matches')).toHaveText(/^No match/)

  await page.getByTestId('action').filter({ hasText: 'Screenshot' }).first().click()
  await expect(page.getByTestId('locator-source')).toHaveText('Edited')
  await expect(page.getByTestId('locator-matches')).toHaveText(/^1 match/)
})

test('resolves locators inside nested iframes', async ({ page }) => {
  await openLocatorTab(page, 'iframe-trace.zip', 'Fill "Alex Example"')
  await typeLocator(page, `locator('iframe[title="Payment frame"]').contentFrame().getByRole('textbox', { name: 'Card holder' })`)
  await expect(page.getByTestId('locator-matches')).toHaveText(/^1 match/)
  await expect(page.frameLocator('iframe[name="snapshot"]').frameLocator('iframe[title="Payment frame"]').locator('x-pw-highlight')).toHaveCount(1)
})

async function typeAria(page: Page, text: string): Promise<void> {
  const editor = page.getByTestId('aria-template').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(text)
}

test('picking fills the ARIA snapshot, and editing it highlights matching elements', async ({ page }) => {
  await openLocatorTab(page, 'demo.zip', 'Fill "alex@example.com"')
  await page.getByRole('button', { name: 'Pick locator' }).first().click()
  await page.frameLocator('iframe[name="snapshot"]').getByRole('button', { name: 'Complete checkout' }).click()
  await expect(page.getByTestId('aria-template')).toContainText('- button "Complete checkout"')

  await typeAria(page, '- button /Complete/')
  await expect(page.getByTestId('aria-source')).toHaveText('Edited')
  await expect(page.getByTestId('aria-matches')).toHaveText(/^1 match/)
  await expect(highlights(page)).toHaveCount(1)

  await typeAria(page, '- heading "Nothing like this"')
  await expect(page.getByTestId('aria-matches')).toHaveText(/^No match/)
  await expect(highlights(page)).toHaveCount(0)

  // Editing the locator again moves the highlight back to it.
  await typeLocator(page, `locator('li.step')`)
  await expect(page.getByTestId('locator-matches')).toHaveText(/^3 matches/)
  await expect(page.getByTestId('aria-matches')).toHaveCount(0)
})

test('ARIA snapshot syntax errors are underlined and listed', async ({ page }) => {
  await openLocatorTab(page, 'demo.zip', 'Fill "alex@example.com"')
  await typeAria(page, '- heading "Checkout"\n- button "Pay')
  await expect(page.getByTestId('aria-template-errors')).toContainText('2:')
  await expect(page.getByTestId('aria-template').locator('.cm-subtleError, .cm-subtleErrorLine')).not.toHaveCount(0)
  await expect(page.getByTestId('aria-matches')).toHaveCount(0)
})

test('picking works while paused on a screencast frame', async ({ page }) => {
  await openLocatorTab(page, 'demo.zip', 'Fill "alex@example.com"')
  const start = Number((await page.getByTestId('timeline-current-time').textContent())!.replace('ms', ''))
  await page.getByTestId('action-scrubber').hover()
  await page.getByTestId('action-scrubber').fill(String(start + 1))
  await expect(page.getByTestId('playback-frame')).toBeVisible()

  await page.getByRole('button', { name: 'Pick locator' }).first().click()
  await expect(page.getByTestId('playback-frame')).toHaveCount(0)
  await page.frameLocator('iframe[name="snapshot"]').getByRole('button', { name: 'Complete checkout' }).click()
  await expect(page.getByTestId('aria-template')).toContainText('- button "Complete checkout"')
})

test('a new pick matches its locator again after the ARIA snapshot was edited', async ({ page }) => {
  await openLocatorTab(page, 'demo.zip', 'Fill "alex@example.com"')
  await typeAria(page, '- button /Complete/')
  await expect(page.getByTestId('aria-matches')).toHaveText(/^1 match/)

  await page.getByRole('button', { name: 'Pick locator' }).first().click()
  await page.frameLocator('iframe[name="snapshot"]').getByRole('button', { name: 'Complete checkout' }).click()
  await expect(page.getByTestId('locator-source')).toHaveText('Snapshot picker')
  await expect(page.getByTestId('locator-matches')).toHaveText(/^1 match/)
  await expect(page.getByTestId('aria-matches')).toHaveCount(0)
})

test('picking and highlights still work after a round trip through ARIA mode', async ({ page }) => {
  await openLocatorTab(page, 'aria-trace.zip', 'Click')
  await expect(page.getByTestId('locator-matches')).toHaveText(/^1 match/)

  await page.getByRole('button', { name: 'ARIA', exact: true }).click()
  await page.getByTestId('action').filter({ hasText: 'Fill' }).first().click()
  await page.getByRole('button', { name: 'DOM', exact: true }).click()
  await expect(highlights(page)).toHaveCount(1)

  await page.getByRole('button', { name: 'Pick locator' }).first().click()
  await page.frameLocator('iframe[name="snapshot"]').getByRole('button', { name: 'Complete checkout' }).click()
  await expect(page.getByTestId('locator-source')).toHaveText('Snapshot picker')
})
