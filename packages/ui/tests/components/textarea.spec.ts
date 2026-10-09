import { expect, test } from '../fixtures'

test.describe('Textarea', () => {
  test('reports what is typed, line breaks included', async ({ mount }) => {
    const component = await mount('Textarea/Stateful')
    await component.getByRole('textbox').fill('flaky\non webkit')
    await expect(component.getByTestId('value')).toHaveText('flaky on webkit')
    await expect(component.getByRole('textbox')).toHaveValue('flaky\non webkit')
  })

  test('passes native attributes through', async ({ mount }) => {
    const component = await mount('Textarea/Stateful')
    const textarea = component.getByRole('textbox')
    await textarea.pressSequentially('a reason well past twenty characters')
    await expect(textarea).toHaveValue('a reason well past t')
  })
})
