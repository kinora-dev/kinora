import { expect, test } from '../fixtures'

test.describe('Skeleton', () => {
  test('is a pulsing placeholder sized by its classes', async ({ mount }) => {
    const component = await mount('Skeleton/Default')
    const skeleton = component.locator('[data-slot="skeleton"]')
    await expect(skeleton).toHaveCSS('width', '160px')
    await expect(skeleton).toHaveCSS('height', '24px')
    await expect(skeleton).toHaveCSS('animation-name', 'pulse')
  })
})
