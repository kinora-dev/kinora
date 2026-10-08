import { expect, test } from '../fixtures'

test.describe('StatBlock', () => {
  test('shows a label and its value', async ({ mount }) => {
    const component = await mount('StatBlock/Default')
    await expect(component.getByText('Runs')).toBeVisible()
    await expect(component.getByText('128')).toBeVisible()
  })

  test('shows the optional sub line', async ({ mount }) => {
    const component = await mount('StatBlock/WithSub')
    await expect(component.getByText('last 20 runs')).toBeVisible()
  })

  test('colors the value with its tone', async ({ mount }) => {
    const component = await mount('StatBlock/FailTone')
    await expect(component.getByText('3', { exact: true })).toContainClass('text-fail')
  })
})
