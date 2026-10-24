---
title: Vitest and Storybook
description: Upload Vitest browser-mode and Storybook test results to kinora with the @kinora/vitest-reporter package.
---

`@kinora/vitest-reporter` uploads the results of [Vitest](https://vitest.dev/) tests that run in a
browser, including [Storybook](https://storybook.js.org/) tests, to kinora. They get the same pages
as Playwright runs: pass rates, flaky tests, per-test history, the Playwright trace of each test,
screenshot comparisons, and for Storybook, the [Components](/guides/component-testing/#the-components-view)
page. **Upload never fails your test run.**

If the kinora server is unreachable or answers `502`, `503`, `504`, `408` or `429` (a deploy, a
restart), the upload is retried for about a minute with growing waits, logging each one. Retries
reuse the same `Idempotency-Key`, so a run is never stored twice.

## Install

```bash
pnpm add -D @kinora/vitest-reporter
# or: npm i -D @kinora/vitest-reporter
```

`vitest` (>=4.1) is a peer dependency.

## Usage

Add it to `vitest.config.ts`, next to the default reporter:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    reporters: ['default', ['@kinora/vitest-reporter', { project: { slug: 'web-app' } }]],
  },
})
```

The token comes from the environment; the server URL defaults to the hosted cloud:

```bash
KINORA_TOKEN=<token> npx vitest run
```

Create an API token in the dashboard under **Settings → Workspace**. Self-hosting? Point at your
server with `KINORA_URL`.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `project` | `{ slug: string, name?: string }` | required | Target project. `name` defaults to `slug`. |
| `url` | `string` | env `KINORA_URL`, then cloud | kinora server base URL. Set for self-host. |
| `token` | `string` | env `KINORA_TOKEN` | Project API token. Prefer the env var. |
| `include` | `'browser' \| 'all'` | `'browser'` | Which tests to upload. See [Node tests](#node-tests). |
| `uploadAttachments` | `('trace' \| 'snapshot' \| 'video' \| 'screenshot')[]` | `['trace', 'snapshot']` | Which attachment kinds to upload. Add `'screenshot'` for Vitest's failure screenshots. |
| `git` | `{ sha?, branch?, baseBranch?, repoUrl? }` | auto on GitHub Actions / GitLab CI | Git metadata. |
| `ci` | `{ provider?, runUrl?, runNumber? }` | auto on GitHub Actions / GitLab CI | CI metadata for the run. |
| `groupKey` | `string \| false` | env `KINORA_GROUP_KEY`, then the CI run | Groups the uploads of every shard of a CI run into one run. `false` uploads each shard as its own run. See [Sharded runs](#sharded-runs). |

## Node tests

Only the tests of Vitest projects running in a browser (browser mode, Storybook) are uploaded by
default. Node unit tests are usually thousands of fast, deterministic tests with no trace: they add
little to kinora and would eat your plan's monthly result quota in a single run.

To upload them too, set `include: 'all'`. A run with no browser test uploads nothing and says so
(a shard of a [sharded run](#sharded-runs) still uploads, empty).

## Sharded runs

With `vitest --shard=1/4`, each shard uploads on its own, and kinora assembles the shards of one CI
run into a single run: shards are grouped by the CI run (`GITHUB_RUN_ID` on GitHub Actions,
`CI_PIPELINE_ID` on GitLab CI), and the shard count comes from Vitest, so there is nothing to
configure.

```yaml
- run: npx vitest run --shard=${{ matrix.shard }}
  env:
    KINORA_TOKEN: ${{ secrets.KINORA_TOKEN }}
```

Elsewhere, set `KINORA_GROUP_KEY` (or the `groupKey` option) to a value shared by the shards of a run
and unique per run. If a matrix runs the sharded suite once per leg (one per browser, say), give each
leg its own `groupKey`, or their shards would fill the same slots.

Vitest splits files across shards whatever their project, so a shard can hold only Node tests. It
then uploads no test, but still fills its slot, so the run can complete.

The run shows as "2 of 4 shards" until the last shard landed, is closed as incomplete if one never
uploads, and a re-run of a failed shard fills its slot again, keeping a test that failed then passed
as flaky. All of it works as for Playwright: see [Sharded runs](/guides/reporter/#sharded-runs).
The Vitest reporter posts no PR comment, so there is none to update.

## Traces

With browser mode and the [Playwright provider](https://vitest.dev/config/browser/playwright),
turn traces on in the browser config. Each test's `trace.zip` is uploaded and opens in kinora's
trace viewer:

```ts
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      trace: 'retain-on-failure',
    },
  },
})
```

Keep the trace files where Vitest puts them by default: with a custom `tracesDir`, Vitest 4 does
not hand the trace to reporters.

## Screenshot comparisons

A failing [`toMatchScreenshot`](https://vitest.dev/api/browser/assertions#tomatchscreenshot)
uploads its reference, actual and diff images, shown on the run page as a
[screenshot comparison](/guides/reporter/#screenshot-comparisons), named after the test.

## Storybook

With [Storybook's Vitest addon](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon),
each story is a Vitest test. The reporter records which story each test renders, as
`<Component>/<Story>` (for example `Button/Primary`), so stories appear on the project's
Components page with no extra setup. Interactions run by a story's `play` function are not
Playwright actions, so the trace shows the rendered story rather than each step.

### Accessibility

With [Storybook's a11y addon](https://storybook.js.org/docs/writing-tests/accessibility-testing),
each story's accessibility check (axe) is uploaded with the test: the rules it breaks, their impact
(critical, serious, moderate, minor), the elements they hit and a link to each rule's
documentation. Only the violations are sent, not axe's full result.

The run and test pages list the violations, most severe first. On the Components page, each story
shows how many rules it breaks, and **Accessibility hotspots** ranks the components by their
stories' violations, weighted by impact, to point at where fixing pays off first.

How a violation counts depends on the addon's `a11y.test` parameter:

- `todo`: a warning. The test passes and kinora records the violations.
- `error`: the test fails. Storybook throws before it stores the check on the test, so kinora reads
  the violations from the failure message instead: you get the rules, elements and links, but not
  their impact. Use `todo` to keep the impact, if your CI does not need to fail on violations.
- `off`: no check, nothing recorded.

Playwright tests get the same views from axe scans attached to the test: see the
[Playwright reporter](/guides/reporter/#accessibility).

## Notes

- Test identity is the file (relative to the Vitest root), the suite path and the Vitest project
  name, which includes the browser in browser mode (`browser (chromium)`). History stays stable as
  long as those don't change.
- The reporter turns on Vitest's test locations, so each test links to its `file:line`.
