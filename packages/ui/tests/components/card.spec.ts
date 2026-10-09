import { expect, test } from '../fixtures'

test.describe('Card', () => {
  test('lays out a titled card with its action and sections', async ({ mount }) => {
    const component = await mount('Card/Default')
    await expect(component.getByRole('heading', { name: 'Web App' })).toBeVisible()
    await expect(component.getByText('Last run 2 hours ago')).toBeVisible()
    await expect(component.getByRole('button', { name: 'Open' })).toBeVisible()
    await expect(component.locator('[data-slot="card-content"]')).toHaveText('98.4% pass rate over the last 20 runs')
    await expect(component.locator('[data-slot="card-footer"]')).toHaveText('main · 1de4783')
  })

  // The action sits in the header's top right corner, level with the title rather than below it.
  test('pins the action beside the title', async ({ mount }) => {
    const component = await mount('Card/Default')
    const title = (await component.getByRole('heading').boundingBox())!
    const action = (await component.getByRole('button', { name: 'Open' }).boundingBox())!
    expect(action.x).toBeGreaterThan(title.x + title.width)
    expect(action.y).toBeLessThan(title.y + title.height)
  })
})
