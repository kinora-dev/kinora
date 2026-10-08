import { expect, test } from '../fixtures'

test.describe('Tabs', () => {
  test('shows the default tab, then the one picked', async ({ mount }) => {
    const component = await mount('Tabs/Default')
    await expect(component.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true')
    await expect(component.getByRole('tabpanel')).toHaveText('Every test of the run')

    await component.getByRole('tab', { name: 'Failed' }).click()
    await expect(component.getByRole('tab', { name: 'Failed' })).toHaveAttribute('aria-selected', 'true')
    await expect(component.getByRole('tabpanel')).toHaveText('Only the failed tests')
  })

  test('moves focus between tabs with the arrow keys', async ({ mount }) => {
    const component = await mount('Tabs/Default')
    await component.getByRole('tab', { name: 'Failed' }).focus()
    await component.page().keyboard.press('ArrowLeft')
    await expect(component.getByRole('tab', { name: 'All' })).toBeFocused()
  })

  test('loops from the last enabled tab back to the first', async ({ mount }) => {
    const component = await mount('Tabs/Default')
    await component.getByRole('tab', { name: 'Failed' }).focus()
    // Skipped is disabled, so Failed is the last reachable tab.
    await component.page().keyboard.press('ArrowRight')
    await expect(component.getByRole('tab', { name: 'All' })).toBeFocused()
  })

  test('keeps a disabled tab out of reach', async ({ mount }) => {
    const component = await mount('Tabs/Default')
    await expect(component.getByRole('tab', { name: 'Skipped' })).toBeDisabled()
  })
})
