import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?trace=fixtures/demo.zip')
  await expect(page.getByTestId('action').first()).toBeVisible()
})

function action(page: import('@playwright/test').Page, title: string | RegExp) {
  return page.getByTestId('action').filter({ hasText: title }).first()
}

test('emphasizes params in the title and shows the locator as a subtitle', async ({ page }) => {
  const fill = action(page, 'Fill "alex@example.com"')
  await expect(fill.getByTestId('action-param')).toHaveText('alex@example.com')
  await expect(fill.getByTestId('action-subtitle')).toHaveText(`locator('#customer')`)
})

test('hovering an action previews it in the detail tabs', async ({ page }) => {
  await page.getByRole('button', { name: 'Call', exact: true }).click()
  await action(page, 'Fill "alex@example.com"').click()
  await expect(page.getByTestId('call-title')).toHaveText('Fill "alex@example.com"')

  await action(page, 'Set content').hover()
  await expect(page.getByTestId('call-title')).toHaveText('Set content')
  await page.getByTestId('call-title').hover()
  await expect(page.getByTestId('call-title')).toHaveText('Fill "alex@example.com"')
})

test('console badge reveals the action console output', async ({ page }) => {
  const badge = action(page, 'Click').getByTestId('action-console-badge')
  await expect(badge).toHaveAccessibleName('Reveal console, 1 warning')
  await badge.click()
  await expect(page.getByRole('button', { name: /^Console/ })).toHaveClass(/text-foreground/)
  await expect(page.getByText('demo warning from checkout flow')).toBeVisible()
})

test('console badge counts errors and warnings', async ({ page }) => {
  await page.goto('/?trace=fixtures/console-rich-trace.zip')
  await expect(page.getByTestId('action-console-badge')).toHaveAccessibleName('Reveal console, 1 error, 1 warning')
})

test('attachment icon opens the action attachment', async ({ page }) => {
  await action(page, 'Attach "note"').getByTestId('action-attachment').click()
  await expect(page.getByRole('button', { name: /^Attachments/ })).toHaveClass(/text-foreground/)
  await expect(page.getByTestId('attachment').filter({ hasText: 'note' })).toHaveAttribute('data-flash', 'true')
})

test('filtering keeps the steps leading to a match', async ({ page }) => {
  await page.getByPlaceholder('Filter actions').fill('Launch browser')
  await expect(page.getByTestId('action')).toHaveText([/Before Hooks/, /Fixture "browser"/, /Launch browser/])
  await expect(action(page, 'Before Hooks')).toHaveAttribute('data-context', 'true')
  await expect(action(page, 'Launch browser')).not.toHaveAttribute('data-context')
})

test('arrow keys fold and walk the action tree, Enter zooms to the action', async ({ page }) => {
  const hooks = action(page, 'Before Hooks')
  const browser = action(page, 'Fixture "browser"')
  await hooks.click()
  await expect(browser).toBeVisible()

  await page.keyboard.press('ArrowLeft')
  await expect(browser).toBeHidden()
  await page.keyboard.press('ArrowRight')
  await expect(browser).toBeVisible()

  // Expanded: Right moves to the first child, Left back to the parent.
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('current-action')).toHaveText('Fixture "browser"')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('current-action')).toHaveText('Before Hooks')

  await page.keyboard.press('Enter')
  await expect(page.getByTestId('reset-zoom')).toBeVisible()
})
