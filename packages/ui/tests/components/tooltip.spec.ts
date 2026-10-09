import { expect, test } from '../fixtures'

// Reka keeps the `role="tooltip"` node hidden from the accessibility tree and links it to the
// trigger with aria-describedby, so the visible bubble is found by its slot, not by role.
const BUBBLE = '[data-slot="tooltip-content"]'

test.describe('Tooltip', () => {
  test('shows on hover and describes its trigger', async ({ mount, page }) => {
    const component = await mount('Tooltip/Default')
    const trigger = component.getByRole('button', { name: 'Copy link' })
    await expect(page.locator(BUBBLE)).toHaveCount(0)

    await trigger.hover()
    await expect(page.locator(BUBBLE)).toContainText('Copies the page URL')
    await expect(trigger).toHaveAccessibleDescription('Copies the page URL')
  })

  test('shows on keyboard focus and hides with Escape', async ({ mount, page }) => {
    await mount('Tooltip/Default')
    await page.keyboard.press('Tab')
    await expect(page.locator(BUBBLE)).toContainText('Copies the page URL')

    await page.keyboard.press('Escape')
    await expect(page.locator(BUBBLE)).toHaveCount(0)
  })
})
