import { expect, test } from '../fixtures'

test.describe('AreaChart', () => {
  test('renders the series and its x axis labels', async ({ mount }) => {
    const component = await mount('AreaChart/Default')
    await expect(component.locator('svg path').first()).toBeAttached()
    // The axis picks which ticks fit; the first bucket is always labelled.
    await expect(component.getByText('Oct 1', { exact: true })).toBeVisible()
    expect(await component.getByText(/^Oct \d$/).count()).toBeGreaterThan(2)
  })

  test('exposes the series color from its config', async ({ mount }) => {
    const component = await mount('AreaChart/Default')
    const chart = component.locator('[data-slot="chart"]')
    await expect(chart).toBeVisible()
    const color = await chart.evaluate(element => getComputedStyle(element).getPropertyValue('--color-count').trim())
    expect(color).not.toBe('')
  })
})
