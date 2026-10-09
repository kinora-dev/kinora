import { expect, test } from '../fixtures'

test.describe('Select', () => {
  test('shows its placeholder until a value is picked', async ({ mount }) => {
    const component = await mount('Select/Branch')
    await expect(component.getByRole('combobox', { name: 'Branch' })).toHaveText('Pick a branch')
    await expect(component.getByTestId('value')).toHaveText('none')
  })

  test('lists grouped options and picks one', async ({ mount, page }) => {
    const component = await mount('Select/Branch')
    const trigger = component.getByRole('combobox', { name: 'Branch' })
    await trigger.click()

    const group = page.getByRole('listbox').getByRole('group', { name: 'Branches' })
    await expect(group.getByRole('option')).toHaveText(['main', 'develop', 'archived'])
    await expect(group.getByRole('option', { name: 'archived' })).toBeDisabled()

    await group.getByRole('option', { name: 'develop' }).click()
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await expect(trigger).toHaveText('develop')
    await expect(component.getByTestId('value')).toHaveText('develop')
  })

  test('picks with the keyboard', async ({ mount, page }) => {
    const component = await mount('Select/Branch')
    await component.getByRole('combobox', { name: 'Branch' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('listbox')).toBeVisible()

    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(component.getByTestId('value')).toHaveText(/main|develop/)
    await expect(page.getByRole('listbox')).toHaveCount(0)
  })
})
