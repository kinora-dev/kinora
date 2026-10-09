import { expect, test } from '../fixtures'

test.describe('RunStrip', () => {
  test('draws one bar per run, oldest first, sized by pass rate', async ({ mount }) => {
    const component = await mount('RunStrip/Default')
    const bars = component.getByRole('button')
    await expect(bars).toHaveCount(4)

    const heights = await bars.locator('span').evaluateAll(spans => spans.map(span => (span as HTMLElement).style.height))
    expect(heights).toEqual(['100%', '100%', '60%', '100%'])
  })

  test('colors each bar by the health of its run', async ({ mount }) => {
    const component = await mount('RunStrip/Default')
    const fills = component.getByRole('button').locator('span')
    await expect(fills.nth(0)).toContainClass('bg-pass')
    await expect(fills.nth(1)).toContainClass('bg-flaky')
    await expect(fills.nth(2)).toContainClass('bg-fail')
  })

  test('selects the run of the bar that is clicked', async ({ mount }) => {
    const component = await mount('RunStrip/Default')
    await component.getByRole('button').nth(2).click()
    await expect(component.getByTestId('selected')).toHaveText('run-3')
  })
})
