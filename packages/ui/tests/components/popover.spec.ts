import { expect, test } from '../fixtures'

test.describe('Popover', () => {
  test('toggles from its trigger', async ({ mount, page }) => {
    const component = await mount('Popover/Default')
    const trigger = component.getByRole('button', { name: 'Filters' })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('dialog', { name: 'Filters' })).toHaveText('Only show runs from the main branch.')
  })

  test('closes with Escape and on a click outside', async ({ mount, page }) => {
    const component = await mount('Popover/Default')
    const trigger = component.getByRole('button', { name: 'Filters' })

    await trigger.click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await trigger.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    // Reka starts listening for outside clicks a tick after the popover opens, sooner than any
    // person could click but not sooner than a test: retry the click until it lands.
    await expect(async () => {
      await page.mouse.click(5, 5)
      await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 500 })
    }).toPass()
  })
})
