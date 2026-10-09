import { expect, test } from '../fixtures'

test.describe('Input', () => {
  test('shows its placeholder while empty', async ({ mount }) => {
    const component = await mount('Input/Default')
    await expect(component.getByRole('textbox', { name: 'Email' })).toHaveAttribute('placeholder', 'you@team.dev')
  })

  test('starts from its default value and can be disabled', async ({ mount }) => {
    const component = await mount('Input/Disabled')
    const input = component.getByRole('textbox', { name: 'Email' })
    await expect(input).toHaveValue('demo@kinora.dev')
    await expect(input).toBeDisabled()
  })

  test('reports what is typed', async ({ mount }) => {
    const component = await mount('Input/Stateful')
    await component.getByRole('textbox', { name: 'Project name' }).fill('Web App')
    await expect(component.getByTestId('value')).toHaveText('Web App')
  })
})
