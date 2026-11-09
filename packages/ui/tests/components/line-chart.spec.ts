import { expect, test } from '../fixtures'

test.describe('LineChart', () => {
  test('draws one line per series', async ({ mount }) => {
    const component = await mount('LineChart/Rates')
    // Unovis hashes its class names (`css-<hash>-linePath`).
    await expect(component.locator('path[class$="-linePath"]')).toHaveCount(2)
    await expect(component.getByText('Oct 1', { exact: true })).toBeVisible()
  })

  test('fits the y axis to the data instead of 0 to 100%', async ({ mount }) => {
    const component = await mount('LineChart/Rates')
    await expect(component.getByText('4%', { exact: true })).toBeVisible()
    await expect(component.getByText('100%', { exact: true })).toHaveCount(0)
  })
})
