import { expect, test } from '../fixtures'

test.describe('Badge', () => {
  test('renders its content', async ({ mount }) => {
    await expect(await mount('Badge/Default')).toHaveText('New')
    await expect(await mount('Badge/Outline')).toHaveText('Beta')
  })

  test('can render as a link', async ({ mount }) => {
    const component = await mount('Badge/AsLink')
    await expect(component.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '#docs')
  })
})
