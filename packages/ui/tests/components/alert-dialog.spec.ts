import { expect, test } from '../fixtures'

test.describe('AlertDialog', () => {
  test('asks for confirmation before acting', async ({ mount, page }) => {
    const component = await mount('AlertDialog/Confirm')
    await component.getByRole('button', { name: 'Delete project' }).click()

    const dialog = page.getByRole('alertdialog', { name: 'Delete Web App?' })
    await expect(dialog).toHaveAccessibleDescription('This removes every run and artifact. It cannot be undone.')
    await expect(component.getByTestId('outcome')).toHaveText('pending')
  })

  test('cancels without acting', async ({ mount, page }) => {
    const component = await mount('AlertDialog/Confirm')
    await component.getByRole('button', { name: 'Delete project' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click()

    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(component.getByTestId('outcome')).toHaveText('cancelled')
  })

  test('acts on confirm', async ({ mount, page }) => {
    const component = await mount('AlertDialog/Confirm')
    await component.getByRole('button', { name: 'Delete project' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()

    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(component.getByTestId('outcome')).toHaveText('confirmed')
  })

  // Unlike a plain dialog: a destructive question must be answered, not dismissed by accident.
  test('stays open on a click outside', async ({ mount, page }) => {
    const component = await mount('AlertDialog/Confirm')
    await component.getByRole('button', { name: 'Delete project' }).click()
    await page.mouse.click(5, 5)

    await expect(page.getByRole('alertdialog')).toBeVisible()
    await expect(component.getByTestId('outcome')).toHaveText('pending')
  })
})
