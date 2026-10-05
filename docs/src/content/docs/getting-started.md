---
title: Getting started
description: Create a project, push your first Playwright run, and see it in the dashboard.
---

This walks you from zero to your first run in the dashboard. It uses the hosted cloud; to run
your own server, see [Self-hosting](/self-hosting/) first, then come back at step 3 and point the
reporter at your own URL.

## 1. Create an account and a project

Sign up at [app.kinora.dev](https://app.kinora.dev), then create a project. A project is one
test suite you track over time (usually one repo). Note its **slug** (e.g. `web-app`).

## 2. Get an API token

In the dashboard, go to **Settings → Workspace** and create an API token. Keep it in your CI
secrets, never in the committed config.

## 3. Add the reporter

The reporter auto-uploads at the end of every `playwright test` run. One line in your config:

```ts
// playwright.config.ts
export default defineConfig({
  reporter: [['@kinora/reporter', { project: { slug: 'web-app' } }]],
  // enable tracing so "View trace" works on failures
  use: { trace: 'on-first-retry' },
})
```

Set the token via env when you run tests:

```bash
KINORA_TOKEN=<token> npx playwright test
```

On GitHub Actions, git and CI metadata (branch, commit, PR) are filled in automatically. For all
reporter options and a full CI example, see the [reporter package](https://github.com/kinora-dev/kinora/tree/main/packages/reporter).

## 4. See your run

Open the dashboard. The run appears on the project overview with its pass rate; failing tests
get a **View trace** button that opens the full Playwright trace inline.

## Alternative: upload with the CLI

If you can't add the reporter, or want to push an existing `results.json` from a separate CI
job, use the CLI instead:

```bash
# playwright.config.ts: reporter: [['json', { outputFile: 'results.json' }]]
npx @kinora/cli upload results.json --project web-app --token <token>
```

Both paths derive the same test identity, so history stays stable no matter how a result was
uploaded. See the [CLI package](https://github.com/kinora-dev/kinora/tree/main/packages/cli) for
all flags, and `kinora import <dir>` to bulk-import a backlog of historical reports.

## Next steps

- [Self-hosting](/self-hosting/): run the whole stack yourself.
- [Live demo](https://demo.kinora.dev): explore the dashboard with seeded data.
