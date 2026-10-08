import { expect, test } from '../fixtures'

const LABELS = { Passing: 'Passing', Flaky: 'Flaky', Failing: 'Failing', Empty: 'No tests' }

test.describe('HealthBadge', () => {
  for (const [story, label] of Object.entries(LABELS)) {
    test(`labels the ${story.toLowerCase()} state`, async ({ mount }) => {
      await expect(await mount(`HealthBadge/${story}`)).toHaveText(label)
    })
  }
})
