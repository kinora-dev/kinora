import { expect, test } from '../fixtures'

// Dialog content is portalled to <body>, outside the gallery root, so it is queried from the page.
test.describe('Dialog', () => {
  test('opens from its trigger with a title and description', async ({ mount, page }) => {
    const component = await mount('Dialog/Default')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await component.getByRole('button', { name: 'Send feedback' }).click()
    const dialog = page.getByRole('dialog', { name: 'Send feedback' })
    await expect(dialog.getByRole('heading', { name: 'Send feedback' })).toBeVisible()
    await expect(dialog).toHaveAccessibleDescription('Tell us what is missing or broken.')
  })

  test('closes with Escape and hands focus back to the trigger', async ({ mount, page }) => {
    const component = await mount('Dialog/Default')
    const trigger = component.getByRole('button', { name: 'Send feedback' })
    await trigger.click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })

  test('closes from its corner button and from a DialogClose', async ({ mount, page }) => {
    const component = await mount('Dialog/Default')
    const trigger = component.getByRole('button', { name: 'Send feedback' })

    await trigger.click()
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await trigger.click()
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})
