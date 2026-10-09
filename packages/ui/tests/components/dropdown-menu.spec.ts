import { expect, test } from '../fixtures'

test.describe('DropdownMenu', () => {
  test('opens a labelled menu from its trigger', async ({ mount, page }) => {
    const component = await mount('DropdownMenu/Account')
    await component.getByRole('button', { name: 'Account' }).click()

    const menu = page.getByRole('menu', { name: 'Account' })
    await expect(menu.getByText('demo@kinora.dev')).toBeVisible()
    await expect(menu.getByRole('menuitem')).toHaveText(['Settings', 'Billing', 'Sign out'])
    await expect(menu.getByRole('menuitem', { name: 'Billing' })).toBeDisabled()
  })

  test('selects an item and closes', async ({ mount, page }) => {
    const component = await mount('DropdownMenu/Account')
    await component.getByRole('button', { name: 'Account' }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()

    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(component.getByTestId('picked')).toHaveText('sign-out')
  })

  test('is driven by the keyboard, skipping the disabled item', async ({ mount, page }) => {
    const component = await mount('DropdownMenu/Account')
    await component.getByRole('button', { name: 'Account' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeFocused()

    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(component.getByTestId('picked')).toHaveText('sign-out')
  })

  test('closes with Escape without selecting', async ({ mount, page }) => {
    const component = await mount('DropdownMenu/Account')
    await component.getByRole('button', { name: 'Account' }).click()
    await page.keyboard.press('Escape')

    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(component.getByTestId('picked')).toHaveText('none')
  })
})
