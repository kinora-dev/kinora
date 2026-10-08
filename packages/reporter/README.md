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

## Documentation

Full reporter options, PR/MR comments, CI examples, and self-hosting are in the docs:

**https://docs.kinora.dev/guides/reporter/**

## License

MIT
