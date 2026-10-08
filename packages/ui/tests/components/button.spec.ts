import { expect, test } from '../fixtures'

test.describe('Button', () => {
  test('renders its label as a button', async ({ mount }) => {
    const component = await mount('Button/Primary')
    await expect(component.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  })

  test('exposes its variant for styling hooks', async ({ mount }) => {
    await expect((await mount('Button/Outline')).getByRole('button')).toHaveAttribute('data-variant', 'outline')
    await expect((await mount('Button/Destructive')).getByRole('button')).toHaveAttribute('data-variant', 'destructive')
  })

  test('cannot be clicked when disabled', async ({ mount }) => {
    const component = await mount('Button/Disabled')
    await expect(component.getByRole('button')).toBeDisabled()
  })

  test('emits a click per press', async ({ mount }) => {
    const component = await mount('Button/CountsClicks')
    const button = component.getByRole('button', { name: 'Click me' })
    await button.click()
    await button.click()
    await expect(component.getByTestId('clicks')).toHaveText('2')
  })
})
