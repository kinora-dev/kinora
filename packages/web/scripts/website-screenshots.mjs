// Regenerate the website app screenshots from the deterministic market seed.
//
//   pnpm --filter @kinora/server db:seed:market   # one-time, gives market@kinora.dev
//   pnpm dev:server & pnpm dev:web & pnpm dev:viewer
//   node packages/web/scripts/website-screenshots.mjs
//
// Captures each view light + dark at 1440x900 @2x (2880x1800) into the website assets.
// WEB_URL points at another dashboard; VIEWS=components,tests captures only those views.
import process from 'node:process'
import { chromium } from '@playwright/test'

const WEB = process.env.WEB_URL ?? 'http://localhost:5173'
const OUT = new URL('../../../website/src/assets/screenshots/', import.meta.url).pathname
const VIEWPORT = { width: 1440, height: 900 }
const EMAIL = 'market@kinora.dev'
const PASSWORD = 'password123'
// Keys of NEW_UNTIL in src/composables/useNewFeature.ts.
const NEW_FEATURES = ['components', 'analytics']

const browser = await chromium.launch()

// 1. Log in once; reuse the session for every capture.
const auth = await browser.newContext({ viewport: VIEWPORT })
const lp = await auth.newPage()
await lp.goto(`${WEB}/login`)
await lp.getByRole('textbox', { name: 'Email' }).fill(EMAIL)
await lp.getByRole('textbox', { name: 'Password' }).fill(PASSWORD)
await lp.getByRole('button', { name: 'Sign in' }).click()
await lp.waitForURL(`${WEB}/`)
const storageState = await auth.storageState()
await auth.close()

// 2. Discover the dynamic URLs (test key + trace viewer URL change per reseed).
const disc = await browser.newContext({ viewport: VIEWPORT, storageState })
const dp = await disc.newPage()
await dp.goto(`${WEB}/projects/checkout-api/runs/checkout-api-run-90?status=unexpected`)
await dp.waitForLoadState('networkidle')
// A currently-failing test -> its history page shows the red timeline + the error. Failed only,
// as the full list pushes it off screen.
const testHref = await dp.getByRole('link', { name: 'refunds an order' }).first().getAttribute('href')
const traceHref = await dp.locator('a:has-text("View trace")').first().getAttribute('href')
await disc.close()
console.log('discovered:', { testHref, traceHref })

const views = [
  { name: 'overview', url: `${WEB}/` },
  { name: 'project', url: `${WEB}/projects/checkout-api` },
  // 90 days, where the seed's recovery shows as a trend. Settles past the chart's entry animation.
  // Scrolled to the stats, a bit taller, so both charts fit the frame.
  { name: 'analytics', url: `${WEB}/projects/web-app/analytics?range=90`, settle: 1800, scrollTo: '[aria-label="Range totals"]', height: 1000 },
  { name: 'tests', url: `${WEB}/projects/checkout-api/tests` },
  { name: 'test-history', url: `${WEB}${testHref}` },
  { name: 'compare', url: `${WEB}/projects/checkout-api/compare?base=checkout-api-run-89&head=checkout-api-run-90` },
  { name: 'trace-viewer', url: traceHref, settle: 3000 },
  { name: 'components', url: `${WEB}/projects/design-system/components` },
  // The failed visual assertion of the design system: expected, actual and diff side by side.
  { name: 'screenshot-diff', url: `${WEB}/projects/design-system/runs/design-system-run-90?test=${encodeURIComponent('tests/components/date-picker.spec.ts::tests/components/date-picker.spec.ts › range highlights the selected days::chromium')}`, scrollTo: 'figure[aria-label^="Screenshot "]', prepare: page => page.getByText('Side by side', { exact: true }).click() },
  // Axe scans of a Playwright project: hotspots by test file and the tests breaking a rule.
  { name: 'a11y', url: `${WEB}/projects/web-app/tests?show=all&a11y=true` },
].filter(v => !process.env.VIEWS || process.env.VIEWS.split(',').includes(v.name))

for (const theme of ['light', 'dark']) {
  // kinora apps read `kinora-theme`; the vendored trace viewer themes off prefers-color-scheme.
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: theme, storageState })
  await ctx.addInitScript(`localStorage.setItem('kinora-theme', ${JSON.stringify(theme)})`)
  // Marketing shots show the product, not its launch: mark every announced feature as seen so
  // the "New" badges (useNewFeature) stay hidden.
  await ctx.addInitScript(`for (const f of ${JSON.stringify(NEW_FEATURES)}) localStorage.setItem('kinora:seen:' + f, 'true')`)
  const page = await ctx.newPage()
  for (const v of views) {
    await page.setViewportSize({ ...VIEWPORT, height: v.height ?? VIEWPORT.height })
    await page.goto(v.url)
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(v.settle ?? 700)
    await v.prepare?.(page)
    if (v.scrollTo) {
      // Below the sticky app header (56px), with some room above.
      await page.locator(v.scrollTo).evaluate(el => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 88))
      await page.waitForTimeout(300)
    }
    await page.screenshot({ path: `${OUT}/${v.name}-${theme}.png` })
    console.log(`wrote ${v.name}-${theme}.png`)
  }
  await ctx.close()
}

await browser.close()
console.log('done')
