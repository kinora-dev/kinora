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
