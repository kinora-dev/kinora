import { expect, test } from '../fixtures'

test.describe('Command', () => {
  test('lists its items under their group', async ({ mount }) => {
    const component = await mount('Command/Branches')
    const group = component.getByRole('listbox').getByRole('group', { name: 'Branches' })
    await expect(group.getByRole('option')).toHaveText(['main', 'develop', 'release/2026-10'])
  })

  test('filters as you type, ignoring case', async ({ mount }) => {
    const component = await mount('Command/Branches')
    await component.getByPlaceholder('Search branch...').fill('DEV')
    await expect(component.getByRole('option')).toHaveText(['develop'])
  })

  test('says so when nothing matches, and hides the empty group', async ({ mount }) => {
    const component = await mount('Command/Branches')
    await component.getByPlaceholder('Search branch...').fill('zzz')
    await expect(component.getByText('No branch found.')).toBeVisible()
    await expect(component.getByRole('option')).toHaveCount(0)
    await expect(component.getByRole('group')).toHaveCount(0)
  })

  test('picks an item with a click or the keyboard', async ({ mount, page }) => {
    const component = await mount('Command/Branches')
    await component.getByRole('option', { name: 'develop' }).click()
    await expect(component.getByTestId('picked')).toHaveText('develop')

    await component.getByPlaceholder('Search branch...').fill('release')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(component.getByTestId('picked')).toHaveText('release/2026-10')
  })
})
