import { expect, test } from '../fixtures'

test.describe('SegmentedControl', () => {
  test('selects the option that is clicked', async ({ mount }) => {
    const component = await mount('SegmentedControl/Stateful')
    await expect(component.getByRole('radio', { name: 'System' })).toBeChecked()

    await component.getByRole('radio', { name: 'Dark' }).click()
    await expect(component.getByRole('radio', { name: 'Dark' })).toBeChecked()
    await expect(component.getByTestId('value')).toHaveText('dark')
  })

  test('keeps options named when it only shows icons', async ({ mount }) => {
    const component = await mount('SegmentedControl/IconOnly')
    await expect(component.getByRole('radio', { name: 'Light' })).toBeChecked()
    await expect(component.getByRole('radio', { name: 'Dark' })).toHaveAttribute('title', 'Dark')
  })
})
