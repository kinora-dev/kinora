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

Traces are uploaded by default, and Playwright already embeds a test's screenshots and video
inside its trace.zip. If you run without tracing, upload them on their own:

```ts
reporter: [['@kinora/reporter', {
  project: { slug: 'web-app' },
  uploadAttachments: ['trace', 'video', 'screenshot'],
}]]
```

Kinora uploads whatever Playwright attached, so `screenshot: 'only-on-failure'` and
`video: 'retain-on-failure'` keep deciding what exists in the first place.

## Documentation

Full reporter options, PR/MR comments, CI examples, and self-hosting are in the docs:

**https://docs.kinora.dev/guides/reporter/**

## License

MIT
