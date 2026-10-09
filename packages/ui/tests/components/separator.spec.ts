import { expect, test } from '../fixtures'

test.describe('Separator', () => {
  test('is a decorative horizontal rule by default', async ({ mount }) => {
    const component = await mount('Separator/Decorative')
    const rule = component.locator('[data-slot="separator"]')
    await expect(rule).toHaveAttribute('role', 'none')
    await expect(rule).toHaveAttribute('data-orientation', 'horizontal')
    // 1px tall across its container.
    await expect(rule).toHaveCSS('height', '1px')
    await expect(rule).toHaveCSS('width', '160px')
  })

  test('is announced as a separator when it is not decorative', async ({ mount }) => {
    const component = await mount('Separator/Semantic')
    const rule = component.getByRole('separator')
    await expect(rule).toHaveAttribute('aria-orientation', 'vertical')
    await expect(rule).toHaveCSS('width', '1px')
  })
})
