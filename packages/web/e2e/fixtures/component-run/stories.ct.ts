import { expect, test } from '../../../../reporter/src/ct.ts'

test('button states', async ({ mount }) => {
  await expect((await mount('components/Button/Primary')).getByRole('button')).toBeEnabled()
  await expect((await mount('components/Button/Disabled')).getByRole('button')).toBeDisabled()
})

// Fails once after mounting, then passes: the retry must not record the story twice.
test('badge shows its label', async ({ mount }, testInfo) => {
  const component = await mount('Badge/Default')
  expect(testInfo.retry).toBe(1)
  await expect(component.getByRole('status')).toHaveText('New')
})

// The committed baseline is deliberately another color: a real failed screenshot assertion, whose
// expected / actual / diff images the reporter uploads without any option set.
test('swatch matches its baseline', async ({ mount }) => {
  const component = await mount('components/Swatch/Default')
  await expect(component.locator('div')).toHaveScreenshot('swatch.png')
})
