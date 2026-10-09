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

  test('picks an item with a click', async ({ mount }) => {
    const component = await mount('Command/Branches')
    await component.getByRole('option', { name: 'develop' }).click()
    await expect(component.getByTestId('picked')).toHaveText('develop')
  })

  test('moves the highlight with the arrow keys, stops at the end, and picks with Enter', async ({ mount, page }) => {
    const component = await mount('Command/Branches')
    const option = (name: string) => component.getByRole('option', { name })
    await component.getByPlaceholder('Search branch...').focus()
    await expect(option('main')).toHaveAttribute('data-highlighted')

    await page.keyboard.press('ArrowDown')
    await expect(option('develop')).toHaveAttribute('data-highlighted')
    await page.keyboard.press('ArrowDown')
    await expect(option('release/2026-10')).toHaveAttribute('data-highlighted')
    await page.keyboard.press('ArrowDown')
    await expect(option('release/2026-10')).toHaveAttribute('data-highlighted')

    await page.keyboard.press('Enter')
    await expect(component.getByTestId('picked')).toHaveText('release/2026-10')
  })

  test('highlights the first match of a search, ready for Enter', async ({ mount, page }) => {
    const component = await mount('Command/Branches')
    await component.getByPlaceholder('Search branch...').fill('rel')
    await expect(component.getByRole('option', { name: 'release/2026-10' })).toHaveAttribute('data-highlighted')

    // The list re-registers its items a tick after the filter changes, and a key pressed inside
    // that tick is dropped. No person types that fast, so press Enter until the pick lands.
    await expect(async () => {
      await page.keyboard.press('Enter')
      await expect(component.getByTestId('picked')).toHaveText('release/2026-10', { timeout: 500 })
    }).toPass()
  })
})
