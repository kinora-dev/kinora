import { expect, test } from '../fixtures'

test.describe('Sparkline', () => {
  test('draws one point per value and marks the latest', async ({ mount }) => {
    const component = await mount('Sparkline/Default')
    const points = (await component.locator('polyline').getAttribute('points'))!.split(' ')
    expect(points).toHaveLength(8)

    // The dot sits on the last point, and a value of 1 reaches the top of the chart.
    const [x, y] = points.at(-1)!.split(',').map(Number)
    await expect(component.locator('circle')).toHaveAttribute('cx', String(x))
    expect(y).toBe(3)
  })

  test('calls out a marked point with its label', async ({ mount }) => {
    const component = await mount('Sparkline/WithMarkers')
    const marker = component.locator('[data-marker]')
    await expect(marker).toHaveCount(1)
    await expect(marker.locator('title')).toHaveText('Environment incident: staging.example.test')
    const points = (await component.locator('polyline').getAttribute('points'))!.split(' ')
    await expect(marker.locator('circle')).toHaveAttribute('cx', points[5].split(',')[0])
  })

  test('draws nothing without values', async ({ mount }) => {
    const component = await mount('Sparkline/Empty')
    await expect(component.locator('svg')).toBeAttached()
    await expect(component.locator('polyline, polygon, circle')).toHaveCount(0)
  })
})
