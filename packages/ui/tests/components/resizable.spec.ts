import { expect, test } from '../fixtures'

test.describe('Resizable', () => {
  test('splits the group by the default sizes', async ({ mount }) => {
    const component = await mount('Resizable/TwoPanels')
    const handle = component.getByRole('separator')
    await expect(handle).toHaveAttribute('aria-valuenow', '30')
    await expect(handle).toHaveAttribute('aria-valuemin', '20')
    await expect(handle).toHaveAttribute('aria-valuemax', '50')

    const actions = (await component.getByTestId('actions').boundingBox())!
    const snapshot = (await component.getByTestId('snapshot').boundingBox())!
    expect(snapshot.x).toBeGreaterThan(actions.x)
  })

  test('resizes with the keyboard and stops at its bounds', async ({ mount, page }) => {
    const component = await mount('Resizable/TwoPanels')
    const handle = component.getByRole('separator')
    const size = async () => Number(await handle.getAttribute('aria-valuenow'))

    await handle.focus()
    await page.keyboard.press('ArrowRight')
    expect(await size()).toBeGreaterThan(30)

    await page.keyboard.press('End')
    await expect(handle).toHaveAttribute('aria-valuenow', '50')
    await page.keyboard.press('ArrowRight')
    await expect(handle).toHaveAttribute('aria-valuenow', '50')

    await page.keyboard.press('Home')
    await expect(handle).toHaveAttribute('aria-valuenow', '20')
  })

  test('resizes by dragging the handle', async ({ mount, page }) => {
    const component = await mount('Resizable/TwoPanels')
    const handle = component.getByRole('separator')
    const box = (await handle.boundingBox())!

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 5 })
    await page.mouse.up()

    expect(Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThan(35)
  })
})
