import { expect, test } from '../fixtures'

test.describe('Sonner', () => {
  test('shows a toast in the notifications region', async ({ mount, page }) => {
    const component = await mount('Sonner/Default')
    const region = page.getByRole('region', { name: /Notifications/ })
    await expect(region.getByRole('listitem')).toHaveCount(0)

    await component.getByRole('button', { name: 'Notify success' }).click()
    await expect(region.getByRole('listitem')).toHaveText('Test quarantined')
  })

  test('marks each toast with its type for the palette', async ({ mount, page }) => {
    const component = await mount('Sonner/Default')
    await component.getByRole('button', { name: 'Notify success' }).click()
    await component.getByRole('button', { name: 'Notify error' }).click()

    const toasts = page.locator('[data-sonner-toast]')
    await expect(toasts.filter({ hasText: 'Test quarantined' })).toHaveAttribute('data-type', 'success')
    await expect(toasts.filter({ hasText: 'Could not update quarantine' })).toHaveAttribute('data-type', 'error')
  })
})
