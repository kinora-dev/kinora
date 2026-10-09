import { expect, test } from '../fixtures'

test.describe('Form', () => {
  test('wires the label and description to the control', async ({ mount }) => {
    const component = await mount('Form/Email')
    const input = component.getByRole('textbox', { name: 'Email' })
    await expect(input).toHaveAccessibleDescription('We only use it to sign you in.')
    await expect(input).toHaveAttribute('aria-invalid', 'false')
  })

  test('blocks an invalid submit and explains why', async ({ mount }) => {
    const component = await mount('Form/Email')
    const input = component.getByRole('textbox', { name: 'Email' })
    await input.fill('not-an-email')
    await component.getByRole('button', { name: 'Send reset link' }).click()

    await expect(component.getByText('Enter a valid email')).toBeVisible()
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    // The error joins the description, so a screen reader announces both.
    await expect(input).toHaveAccessibleDescription('We only use it to sign you in. Enter a valid email')
    await expect(component.getByTestId('submitted')).toHaveText('none')
  })

  test('clears the error and submits once valid', async ({ mount }) => {
    const component = await mount('Form/Email')
    const input = component.getByRole('textbox', { name: 'Email' })
    await component.getByRole('button', { name: 'Send reset link' }).click()
    await expect(component.getByText('Enter a valid email')).toBeVisible()

    await input.fill('demo@kinora.dev')
    await expect(component.getByText('Enter a valid email')).toHaveCount(0)
    await component.getByRole('button', { name: 'Send reset link' }).click()
    await expect(component.getByTestId('submitted')).toHaveText('demo@kinora.dev')
  })
})
