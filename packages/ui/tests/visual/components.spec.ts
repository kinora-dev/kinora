import type { Locator } from '@playwright/test'
import { expect, test } from '../fixtures'

// Reference images live in ./__screenshots__ and are rendered by the browser of the official
// Playwright Docker image (see scripts/visual.mjs), never by a local one. After an intended
// visual change, regenerate them with `pnpm --filter @kinora/ui test:visual:update`.
type Mount = (story: string) => Promise<Locator>

// Shrink the gallery root to the story and wait for the web fonts: a full-width root would make
// every image mostly blank, and a screenshot taken before the fonts load would not be stable.
async function shoot(mount: Mount, story: string, suffix = ''): Promise<void> {
  const component = await mount(story)
  await component.evaluate(async (root) => {
    (root as HTMLElement).style.width = 'fit-content'
    await document.fonts.ready
  })
  await expect(component).toHaveScreenshot(`${story.replace('/', '-').toLowerCase()}${suffix}.png`)
}

const STORIES = [
  'Button/Primary',
  'Button/Outline',
  'Button/Destructive',
  'Button/Disabled',
  'Badge/Default',
  'Badge/Outline',
  'HealthBadge/Passing',
  'HealthBadge/Flaky',
  'HealthBadge/Failing',
  'StatBlock/WithSub',
  'StatBlock/FailTone',
  'Card/Default',
  'Tabs/Default',
  'Table/Runs',
  'Pagination/Stateful',
  'Sparkline/Default',
  'RunStrip/Default',
  'AreaChart/Default',
]

test.describe('light theme', () => {
  for (const story of STORIES) {
    test(story, async ({ mount }) => {
      await shoot(mount, story)
    })
  }
})

// The theme follows the system by default, so emulating a dark system is the dark theme.
test.describe('dark theme', () => {
  test.use({ colorScheme: 'dark' })

  for (const story of ['Button/Primary', 'Card/Default', 'Table/Runs', 'AreaChart/Default']) {
    test(story, async ({ page, mount }) => {
      await shoot(mount, story, '-dark')
      await expect(page.locator('html')).toContainClass('dark')
    })
  }
})
