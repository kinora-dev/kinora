# @kinora/reporter

Playwright reporter that uploads your test results to a [kinora](https://github.com/kinora-dev/kinora) server: pass rates, trends, flaky tests, and the full Playwright trace for failures, across projects and over time.

It runs on `onEnd`, posts the normalized run, then uploads the trace.zip for each test that produced one (videos and screenshots too, see below). Upload never fails your test run.

## Install

```bash
npm i -D @kinora/reporter
# or: pnpm add -D @kinora/reporter
```

`@playwright/test` (>=1.40) is a peer dependency.

## Usage

Add it to `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  reporter: [['@kinora/reporter', { project: { slug: 'web-app' } }]],
  // enable tracing so failures upload a trace
  use: { trace: 'on-first-retry' },
})
```

The token comes from the environment (keep it out of the config file); the server URL defaults to the hosted cloud:

```bash
KINORA_TOKEN=<token> npx playwright test
```

Create an API token in the kinora dashboard (Settings → Workspace). Self-hosting? Point at your server with `KINORA_URL`.

## Videos and screenshots without tracing

Traces are uploaded by default, along with the expected / actual / diff images of a failed
`toHaveScreenshot`, which kinora shows as a comparison. Playwright already embeds a test's other
screenshots and its video inside the trace.zip. If you run without tracing, upload them on their own:

```ts
reporter: [['@kinora/reporter', {
  project: { slug: 'web-app' },
  uploadAttachments: ['trace', 'video', 'screenshot'],
}]]
```

Kinora uploads whatever Playwright attached, so `screenshot: 'only-on-failure'` and
`video: 'retain-on-failure'` keep deciding what exists in the first place.

## Component tests

Playwright's built-in component testing (the `mount` fixture, Playwright >=1.63) reports like any
other test. To let kinora know which story each test mounted, import `test` from
`@kinora/reporter/ct` instead of `@playwright/test`:

```ts
import { expect, test } from '@kinora/reporter/ct'

test('disabled button is disabled', async ({ mount }) => {
  const component = await mount('components/Button/Disabled')
  await expect(component.getByRole('button')).toBeDisabled()
})
```

Each mounted story id is recorded on the test as a `kinora:story` annotation. Already extending
`test` with your own fixtures? Extend this one instead: `test.extend({ ... })`.

More in the [component testing guide](https://docs.kinora.dev/guides/component-testing/).

## Accessibility

kinora records the axe scans attached to a test: the rules broken, their impact and the elements
they hit. `scanA11y` runs the scan with `@axe-core/playwright` (add it to your dev dependencies)
and attaches the result:

```ts
import { scanA11y } from '@kinora/reporter/a11y'
import { expect, test } from '@playwright/test'

test('checkout is accessible', async ({ page }) => {
  await page.goto('/checkout')
  const { violations } = await scanA11y(page)
  expect(violations).toEqual([]) // leave it out to record the violations as warnings
})
```

A scan you build yourself works too, as long as it is attached to the test with
`testInfo.attach(name, { body: JSON.stringify(results), contentType: 'application/json' })`.
An assertion alone is invisible to a reporter. More in the
[accessibility guide](https://docs.kinora.dev/guides/reporter/#accessibility).

## Checking the app is up

List `@kinora/reporter/check-base-url` in `globalSetup` and the run stops before any test when a
project's `baseURL` does not answer (refused, unresolved, timed out, or a `502` / `503` / `504`):

```ts
export default defineConfig({
  globalSetup: ['@kinora/reporter/check-base-url', './global-setup.ts'],
})
```

`KINORA_CHECK_BASE_URL=false` skips it. More in the
[reporter guide](https://docs.kinora.dev/guides/reporter/#checking-the-app-is-up).

## Documentation

Full reporter options, PR/MR comments, CI examples, and self-hosting are in the docs:

**https://docs.kinora.dev/guides/reporter/**

## License

MIT
