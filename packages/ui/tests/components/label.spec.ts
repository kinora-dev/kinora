import { expect, test } from '../fixtures'

test.describe('Label', () => {
  test('names its input and focuses it on click', async ({ mount }) => {
    const component = await mount('Label/WithInput')
    const input = component.getByRole('textbox', { name: 'Project name' })
    await expect(input).not.toBeFocused()

    await component.getByText('Project name').click()
    await expect(input).toBeFocused()
  })
})
