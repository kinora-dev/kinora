---
title: Playwright reporter
description: Auto-upload every Playwright run to kinora with the @kinora/reporter package.
---

`@kinora/reporter` is a Playwright reporter that uploads your results to kinora at the end of
every run: pass rates, trends, flaky tests, and the full trace for failures. It runs on `onEnd`,
posts the normalized run, then uploads the `trace.zip` for each test that produced one.
**Upload never fails your test run.**

If the kinora server is unreachable or answers `502`, `503`, `504`, `408` or `429` (a deploy, a
restart), the upload is retried for about a minute with growing waits, logging each one. Retries
reuse the same `Idempotency-Key`, so a run is never stored twice.

## Install

```bash
pnpm add -D @kinora/reporter
# or: npm i -D @kinora/reporter
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

The token comes from the environment (keep it out of the config file); the server URL defaults
to the hosted cloud:

```bash
KINORA_TOKEN=<token> npx playwright test
```

Create an API token in the dashboard under **Settings → Workspace**. Self-hosting? Point at your
server with `KINORA_URL` - see [Self-hosting](/self-hosting/).

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `project` | `{ slug: string, name?: string }` | required | Target project. `name` defaults to `slug`. |
| `url` | `string` | env `KINORA_URL`, then cloud | kinora server base URL. Set for self-host. |
| `token` | `string` | env `KINORA_TOKEN` | Project API token. Prefer the env var. |
| `git` | `{ sha?, branch?, baseBranch?, repoUrl? }` | auto on GitHub Actions / GitLab CI | Git metadata. `repoUrl` links a sha to its commit; `baseBranch` powers "regression vs base" in the PR comment. |
| `ci` | `{ provider?, runUrl?, runNumber? }` | auto on GitHub Actions / GitLab CI | CI metadata for the run. |
| `prComment` | `boolean \| { label?, policy? }` | off | Post/update a summary comment on the GitHub PR or GitLab MR. See [PR comments](/guides/pr-comments/). |
| `uploadAttachments` | `('trace' \| 'snapshot' \| 'video' \| 'screenshot')[]` | `['trace', 'snapshot']` | Which attachment kinds to upload. `'snapshot'` is the images behind [screenshot comparisons](#screenshot-comparisons). Add `'video'` / `'screenshot'` when you run without traces. |
| `groupKey` | `string \| false` | env `KINORA_GROUP_KEY`, then the CI run | Groups the uploads of every shard of a CI run into one run. `false` uploads each shard as its own run. See [Sharded runs](#sharded-runs). |

On GitHub Actions and GitLab CI, `git` and `ci` are filled from the standard `GITHUB_*` / `CI_*`
env vars (including the repo URL, so shas link to their commit in the dashboard). On a GitLab merge
request pipeline, the branch is the MR source branch and the base branch its target. Pass them
explicitly on other CI providers.

## Screenshot comparisons

When `toHaveScreenshot` fails, Playwright attaches the expected, actual and diff images. kinora
uploads them by default and the run page shows them as a comparison (diff, actual, expected, side
by side) right under the failing test.

Playwright only attaches these images on a failed assertion, so passing runs upload nothing extra.
To keep them out of your storage, list the kinds yourself without `'snapshot'`:

```ts
reporter: [['@kinora/reporter', {
  project: { slug: 'web-app' },
  uploadAttachments: ['trace'],
}]]
```

## Accessibility

kinora records the accessibility scans of your tests ([axe](https://github.com/dequelabs/axe-core),
through [`@axe-core/playwright`](https://playwright.dev/docs/accessibility-testing)): the rules
each test breaks, their impact (critical, serious, moderate, minor), the elements they hit and a
link to each rule's documentation. The run and test pages list them, most severe first, and the
Tests page ranks your test files by their violations under **Accessibility hotspots**.

The reporter reads a scan from the test's attachments, so **the scan has to be attached to the
test**. With only `expect(results.violations).toEqual([])`, a reporter sees a failed assertion and
nothing else. Two ways to attach it:

**With the helper.** `scanA11y` runs the scan and attaches its result:

```ts
import { scanA11y } from '@kinora/reporter/a11y'
import { expect, test } from '@playwright/test'

test('checkout is accessible', async ({ page }) => {
  await page.goto('/checkout')
  const { violations } = await scanA11y(page)
  expect(violations).toEqual([])
})
```

It needs `@axe-core/playwright` in your dev dependencies. Pass a function to configure the scan,
as you would on `AxeBuilder`:

```ts
await scanA11y(page, axe => axe.withTags(['wcag2a', 'wcag2aa']).exclude('#ads'))
```

**By hand.** If you already build your scans with `AxeBuilder`, attach the result as JSON, as
[Playwright's guide](https://playwright.dev/docs/accessibility-testing#exporting-scan-results-as-a-test-attachment)
shows. Any attachment name works, kinora recognizes an axe result by its content:

```ts
const results = await new AxeBuilder({ page }).analyze()
await testInfo.attach('accessibility-scan-results', {
  body: JSON.stringify(results),
  contentType: 'application/json',
})
expect(results.violations).toEqual([])
```

Attach before you assert, so the scan is there when the assertion fails.

Whether a violation fails the test is your call:

- **Assert on `violations`** and the test fails on them. kinora shows them as the reason.
- **Scan without asserting** and the test passes: kinora records the violations as warnings.
  Useful to track a backlog without blocking CI.

A test can scan several pages or states; kinora merges its scans and keeps each rule once. Only
the violations are uploaded, not axe's full result. The [CLI](/guides/cli/) reads the same
attachments from the JSON report, when they are attached with a `body` (as above), not as a file.

Storybook stories get the same views through the a11y addon: see
[Vitest and Storybook](/guides/vitest/#accessibility).

## Checking the app is up

When the environment under test is down, every test fails and the run only tells you that. Add
`@kinora/reporter/check-base-url` to `globalSetup` and Playwright checks that the `baseURL` of
each project in the run answers before any worker starts:

```ts
export default defineConfig({
  // List it after a setup of yours that starts the app.
  globalSetup: ['@kinora/reporter/check-base-url', './global-setup.ts'],
  reporter: [['@kinora/reporter', { project: { slug: 'web-app' } }]],
})
```

A `baseURL` is down when it refuses the connection, does not resolve, does not answer within 10
seconds, or answers `502`, `503` or `504` (a gateway whose app is down), on each of 3 tries. Any
other answer, a `404` or a `500` included, is the app answering. When one is down, the run stops
with a message naming it and Playwright's failure exit code: no test runs, so the outage costs
no CI time and no run reaches the dashboard.

The request goes through Playwright's request context with the project's `proxy` and
`ignoreHTTPSErrors`, and only the projects the run selects (`--project`, with their
dependencies) are checked. A browser on a remote grid (`connectOptions`) reaches the app from the
grid's network, not from the machine the check runs on: the message says so for such a project.
Set `KINORA_CHECK_BASE_URL=false` to run the tests anyway. Needs Playwright 1.49 or later for a
`globalSetup` list.

A run that still fails because the environment went down is flagged as an
[environment incident](/guides/environment-incidents/).

## CI example (GitHub Actions)

```yaml
- run: npx playwright test
  env:
    KINORA_TOKEN: ${{ secrets.KINORA_TOKEN }}
```

## CI example (GitLab CI)

```yaml
e2e:
  script:
    - npx playwright test # KINORA_TOKEN is a masked CI/CD variable
```

## Sharded runs

With `--shard`, each shard can upload on its own: kinora assembles the shards of one CI run into a
single run, with every test and trace, and no merge job to set up. The [CLI](/guides/cli/#sharded-runs)
and the [Vitest reporter](/guides/vitest/#sharded-runs) do the same.

```yaml
jobs:
  e2e:
    strategy:
      matrix:
        shard: [1/4, 2/4, 3/4, 4/4]
    steps:
      # ... checkout, install
      - run: npx playwright test --shard=${{ matrix.shard }}
        env:
          KINORA_TOKEN: ${{ secrets.KINORA_TOKEN }}
```

Shards are grouped by the CI run (`GITHUB_RUN_ID` on GitHub Actions, `CI_PIPELINE_ID` on GitLab
CI), and the shard count comes from Playwright, so there is nothing to configure. Elsewhere, set
`KINORA_GROUP_KEY` to a value shared by the shards of a run and unique per run. If a matrix runs
the sharded suite once per leg (one per browser, say), give each leg its own `prComment.label` or
`groupKey`, or their shards would fill the same slots.

- **Until every shard landed**, the run shows as "2 of 4 shards" instead of a health, so a run
  missing shards never reads as green. Alerts wait for the last shard, then cover every shard's
  tests. The PR comment updates as each shard lands ("2 of 4 shards landed"), so a shard that
  never uploads leaves it saying so.
- **A shard that never uploads** (its job died) leaves the run incomplete: after two hours it is
  closed as "Incomplete · 3 of 4 shards", and alerts fire then (self-host: set the delay with
  `KINORA_SHARD_TIMEOUT_MINUTES`). A late shard still completes it.
- **Re-running a failed shard** (GitHub's "Re-run failed jobs", a GitLab job retry) fills that
  shard's slot again instead of adding a run. A test that failed on the first attempt and passes
  on the re-run is kept as flaky, so the re-run does not hide it, and the PR comment marks it
  "passed on re-run". Re-run results are not counted again in your usage.

### Merging blob reports

You can also shard with Playwright's
[blob reporter](https://playwright.dev/docs/test-sharding#merging-reports-from-multiple-shards)
and upload once, from the job that merges the shards. kinora then sees a single upload.

The merge step needs its own config. `merge-reports --reporter=@kinora/reporter` would load the
reporter without its options (no project), so set the reporter in a config passed with `-c`, with
the same `testDir` as your main config so tests keep their identity:

```ts
// merge.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  reporter: [['@kinora/reporter', { project: { slug: 'web-app' } }]],
})
```

```yaml
jobs:
  e2e:
    strategy:
      matrix:
        shard: [1/4, 2/4, 3/4, 4/4]
    steps:
      # ... checkout, install
      - run: npx playwright test --shard=${{ matrix.shard }} --reporter=blob
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: blob-report-${{ strategy.job-index }}
          path: blob-report
  report:
    needs: e2e
    if: ${{ !cancelled() }}
    steps:
      # ... checkout, install
      - uses: actions/download-artifact@v4
        with:
          path: all-blob-reports
          pattern: blob-report-*
          merge-multiple: true
      - run: npx playwright merge-reports -c merge.config.ts ./all-blob-reports
        env:
          KINORA_TOKEN: ${{ secrets.KINORA_TOKEN }}
```

A shard that dies before uploading its blob is simply missing from the merged report, and nothing
in kinora says so: prefer direct uploads if that matters to you.

## Notes

- If `KINORA_TOKEN` is missing, the reporter logs a warning and skips the upload, so local runs
  aren't affected. `KINORA_URL` is optional (defaults to the hosted cloud).
- Traces are uploaded only for tests that produced one, so enable `trace` in your Playwright
  config (`on-first-retry`, `retain-on-failure`, etc.).
- Cross-run test identity is the file + title path + Playwright project name, so history stays
  stable as long as those don't change.

## When to use the CLI instead

If your results are produced in one CI job and uploaded from another, or you want to bulk-import
a backlog, use the [CLI](/guides/cli/) instead.
