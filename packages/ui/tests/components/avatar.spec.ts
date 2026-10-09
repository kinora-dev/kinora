import { expect, test } from '../fixtures'

test.describe('Avatar', () => {
  test('shows the image once it loads', async ({ mount }) => {
    const component = await mount('Avatar/WithImage')
    await expect(component.getByRole('img', { name: 'Demo User' })).toBeVisible()
    await expect(component.getByText('DU')).toHaveCount(0)
  })

  test('falls back to the initials when the image fails', async ({ mount }) => {
    const component = await mount('Avatar/Fallback')
    await expect(component.getByText('DU')).toBeVisible()
    await expect(component.getByRole('img')).toHaveCount(0)
  })
})
