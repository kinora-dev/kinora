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
const CARD_WIDTH = 1000
// Room kept around a crop, in CSS pixels.
const PAD = 24

// The run page card of the one test shown, from its title down to its trace link.
const testCard = page => page.locator('main div.rounded-xl, main div.rounded-lg').filter({ has: page.getByRole('link', { name: 'View trace' }) }).last()
// The dashboard card holding a title.
const card = (page, title) => page.locator('[data-slot="card"]').filter({ hasText: title }).first()

// Rectangle spanning both elements, padded. Crop views get a viewport tall enough to hold the
// whole crop unscrolled, so viewport coordinates are the screenshot's.
const CROP_HEIGHT = 2400
async function cropBox(page, [first, last], pad = PAD) {
  const [a, b] = await Promise.all([first, last].map(l => l.boundingBox()))
  const viewport = page.viewportSize()
  const x = Math.max(0, Math.min(a.x, b.x) - pad)
  const y = Math.max(0, Math.min(a.y, b.y) - pad)
  const right = Math.min(viewport.width, Math.max(a.x + a.width, b.x + b.width) + pad)
  const bottom = Math.min(viewport.height, Math.max(a.y + a.height, b.y + b.height) + pad)
  return { x, y, width: right - x, height: bottom - y }
}

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
  // Web App: no new failure there, so its first rows show Flaky and Broken badges side by side.
  { name: 'tests', url: `${WEB}/projects/web-app/tests` },
  { name: 'test-history', url: `${WEB}${testHref}` },
  { name: 'compare', url: `${WEB}/projects/checkout-api/compare?base=checkout-api-run-89&head=checkout-api-run-90` },
  { name: 'trace-viewer', url: traceHref, settle: 3000 },
  { name: 'components', url: `${WEB}/projects/design-system/components` },

  // Card crops for the landing grids, where a full 1440px page shrinks to unreadable. Narrower and
  // cut to the part the card talks about. `crop` names the first and last element to keep.
  { name: 'project-card', url: `${WEB}/`, width: CARD_WIDTH, crop: page => [page.locator('main [data-slot="card"]').nth(1), page.locator('main [data-slot="card"]').nth(4)] },
  // 90 days, where the seed's flaky drift shows. Settles past the charts' entry animation.
  { name: 'analytics-card', url: `${WEB}/projects/web-app/analytics?range=90`, settle: 1800, width: CARD_WIDTH, crop: page => [card(page, 'Test outcomes'), card(page, 'Flaky and failure rate')] },
  { name: 'test-history-card', url: `${WEB}${testHref}`, width: CARD_WIDTH, crop: page => [page.locator('main h1'), page.locator('div.rounded-xl').filter({ has: page.getByText('Status timeline', { exact: true }) }).last()] },
  { name: 'compare-card', url: `${WEB}/projects/checkout-api/compare?base=checkout-api-run-89&head=checkout-api-run-90`, width: CARD_WIDTH, crop: page => [page.locator('main h1'), page.locator('main a[href*="/test?"]').last()] },
  { name: 'a11y-card', url: `${WEB}/projects/web-app/runs/web-app-run-90?test=${encodeURIComponent('tests/search.spec.ts::tests/search.spec.ts › returns relevant results::chromium')}`, width: CARD_WIDTH, crop: page => [testCard(page), testCard(page)] },
  { name: 'screenshot-diff-card', url: `${WEB}/projects/design-system/runs/design-system-run-90?test=${encodeURIComponent('tests/components/date-picker.spec.ts::tests/components/date-picker.spec.ts › range highlights the selected days::chromium')}`, width: CARD_WIDTH, prepare: page => page.getByText('Side by side', { exact: true }).click(), pad: 2, crop: page => [page.locator('figure[aria-label^="Screenshot "]'), page.locator('figure[aria-label^="Screenshot "]')] },
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
    await page.setViewportSize({ width: v.width ?? VIEWPORT.width, height: v.crop ? CROP_HEIGHT : VIEWPORT.height })
    await page.goto(v.url)
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(v.settle ?? 700)
    await v.prepare?.(page)
    // Images settle a crop's height; wait for them before measuring it.
    await page.waitForFunction(() => [...document.images].every(img => img.complete)).catch(() => {})
    if (v.crop)
      await page.screenshot({ path: `${OUT}/${v.name}-${theme}.png`, clip: await cropBox(page, v.crop(page), v.pad) })
    else
      await page.screenshot({ path: `${OUT}/${v.name}-${theme}.png` })
    console.log(`wrote ${v.name}-${theme}.png`)
  }
  await ctx.close()
}

await browser.close()
console.log('done')
