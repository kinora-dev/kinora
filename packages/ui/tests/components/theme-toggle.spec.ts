import { expect, test } from '../fixtures'

test.describe('ThemeToggle', () => {
  // The choice is persisted and the browser context is reused between tests, so undo both the
  // stored choice and the emulated system theme.
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => localStorage.clear())
    await page.emulateMedia({ colorScheme: null })
  })

  test('follows the system by default', async ({ mount, page }) => {
    const component = await mount('ThemeToggle/Default')
    await component.getByRole('button', { name: 'Theme' }).click()

    const menu = page.getByRole('menu', { name: 'Theme' })
    await expect(menu.getByRole('menuitemradio')).toHaveText(['System', 'Light', 'Dark'])
    await expect(menu.getByRole('menuitemradio', { name: 'System' })).toBeChecked()
  })

  test('switches the page to dark and remembers it', async ({ mount, page }) => {
    const component = await mount('ThemeToggle/Default')
    await component.getByRole('button', { name: 'Theme' }).click()
    await page.getByRole('menuitemradio', { name: 'Dark' }).click()

    await expect(page.locator('html')).toContainClass('dark')
    expect(await page.evaluate(() => localStorage.getItem('kinora-theme'))).toBe('dark')

    // Still dark after a reload: the stored choice is applied on boot.
    const reloaded = await mount('ThemeToggle/Default')
    await expect(page.locator('html')).toContainClass('dark')
    await reloaded.getByRole('button', { name: 'Theme' }).click()
    await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toBeChecked()
  })

  test('switches back to light', async ({ mount, page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    const component = await mount('ThemeToggle/Default')
    await expect(page.locator('html')).toContainClass('dark')

    await component.getByRole('button', { name: 'Theme' }).click()
    await page.getByRole('menuitemradio', { name: 'Light' }).click()
    await expect(page.locator('html')).not.toContainClass('dark')
  })
})
