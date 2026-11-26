---
title: "How to open a Playwright trace from a CI run"
description: A test failed in CI and Playwright recorded a trace. Here is how to get that trace.zip out of CI and open it, why the downloaded HTML report refuses to show it, and which trace mode records the attempt you actually need.
date: 2026-11-26
tags:
  - playwright
  - testing
  - ci
  - debugging
slug: open-playwright-trace-from-ci
image: /og-image.png
imageAlt: The Playwright trace viewer embedded in Kinora, opened on the failing action of a CI run
cover: trace-viewer
author:
  name: Joris Gallot
  url: https://jorisgallot.dev
draft: false
---

A test fails in CI. The log says `Timeout 5000ms exceeded` while waiting for a locator, which tells you almost nothing. Locally, it passes.

What would explain it is the trace: every action, the page before and after it, the network, the console. Playwright recorded it. It is somewhere in that CI job. Getting from the red check to that trace, open on the failing step, takes more steps than it should, and a few of them go wrong without telling you.

## First, make sure the trace you need exists

Playwright records a trace only when `use.trace` asks for one, and the mode decides which attempt you get. The most common setting is `on-first-retry`:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  retries: process.env.CI ? 2 : 0,
  use: { trace: 'on-first-retry' },
})
```

It is cheap, but it has two catches. Without retries there is no first retry, so there is no trace at all. And the trace comes from the retry, not from the attempt that failed. When a test is flaky and passes on its retry, you get a clean trace of the run that worked and nothing from the one that did not.

The modes worth knowing:

| Mode | Records | Keeps |
| --- | --- | --- |
| `on-first-retry` | the first retry only | that trace, pass or fail |
| `retain-on-first-failure` | the first attempt only | that trace, if it failed |
| `retain-on-failure` | every attempt | the failed ones, even when a later retry passed |
| `on` | every attempt | all of them |

For CI, I would pick `retain-on-failure`. The failed attempt is always there, flaky tests included, and that is the trace you want. It records every test, which adds some overhead. If that matters on a large suite, `retain-on-first-failure` only records the first attempt and still catches the failure.

## Getting the trace out of CI

Traces land in the Playwright output: in `test-results/`, one folder per test, and inside the HTML report under `playwright-report/data/`. The CI runner throws all of it away at the end of the job, so it has to be uploaded as an artifact. On GitHub Actions:

```yaml
- uses: actions/upload-artifact@v7
  if: ${{ !cancelled() }}
  with:
    name: playwright-report
    path: playwright-report/
    retention-days: 30
```

Do not skip the `if: ${{ !cancelled() }}`. Without it, the step is skipped when the test step fails, which is exactly when you need it.

Then, to read it: open the workflow run, scroll to the artifacts, download a zip, unzip it. Or from a terminal, with the GitHub CLI:

```bash
gh run download <run-id> -n playwright-report
npx playwright show-report playwright-report
```

## Why the downloaded report cannot open the trace

The usual reflex after unzipping is to double-click `index.html`. The report opens, the failed test is there, you click its trace and get this:

> Trace Viewer uses Service Workers to show traces.

The trace viewer reads the zip through a service worker, and browsers do not run service workers on `file://` pages. The report has to be served over HTTP, which is what `npx playwright show-report` does. The same goes for a report published to static hosting: it works over https, not from a copy on disk.

## Opening a single trace.zip

When all you have is the zip, there are two ways in:

```bash
npx playwright show-trace path/to/trace.zip
```

opens it in a local window. `show-trace` also takes a URL, so if your CI stores traces somewhere reachable over HTTP, you can skip the download.

[trace.playwright.dev](https://trace.playwright.dev) is a hosted copy of the same viewer. Drop the zip on it and it is read in your browser, not uploaded. It also accepts `?trace=<url>`, as long as the server hosting the zip allows cross-origin requests.

Neither URL option works with GitHub Actions artifacts: their download links need an authenticated request. For those, you are back to downloading and unzipping.

## The trace you want next week

All of this works for the failure in front of you. It breaks down for the questions that come later. When did this test start failing? What did the page look like the last time it failed, two weeks ago, on someone else's branch? By then the artifact may have expired, or it is one artifact among hundreds and nobody remembers which run it was.

A trace is most useful attached to the test it belongs to, next to that test's history. That is the one thing CI artifacts cannot give you. It is also why a trace matters so much for [flaky tests](/blog/track-flaky-playwright-tests): the failure you need to understand happened in some past run, not in the one in front of you.

## Doing it with Kinora

[Kinora](https://kinora.dev) is an open source dashboard for Playwright runs, with the trace viewer built in. Its reporter uploads the run along with the `trace.zip` of every test that produced one:

```bash
npm i -D @kinora/reporter
```

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  retries: process.env.CI ? 2 : 0,
  use: { trace: 'retain-on-failure' },
  reporter: [
    ['html'],
    ['@kinora/reporter', { project: { slug: 'web-app' } }],
  ],
})
```

There is no artifact step to add. Sharded runs upload from each shard and are assembled into one run, with every trace.

On the run page, each failing test has a **View trace** link. It opens the Playwright trace viewer in the browser, the real one vendored from Playwright, on the failing action. The address bar follows the action you select, so copying it gives a link to that exact step, ready to paste in a pull request or an issue.

Traces stay with their runs. A test's history links to each past run, and its trace still opens there. How long they are kept depends on your plan on the cloud. When you self-host it is up to you, and `KINORA_ARTIFACT_RETENTION_DAYS` deletes old traces while keeping the runs and their history. Quarantining a flaky test also pins the trace of its latest failure, so you can check a fix against the original failure even after retention removed that run.

For traces that never went through CI, there are two more ways in, neither of which needs an account:

- the [online trace viewer](/playwright-trace-viewer-online) opens a local `trace.zip` in your browser, read locally like trace.playwright.dev;
- the [desktop app](https://docs.kinora.dev/guides/desktop/) opens a `trace.zip` from your file manager. Signed in, it can also re-run a failing test from your dashboard locally, with your repo's own Playwright, and open the trace it produces.

## The short version

1. Use `trace: 'retain-on-failure'` in CI, so the failed attempt is always recorded.
2. Upload the report with `if: ${{ !cancelled() }}`.
3. Open a downloaded report with `npx playwright show-report`, never from `file://`.
4. If you will want that trace in a week, keep it next to the test's history, not in an artifact that expires.

## Try it

- [Playwright reporter guide](https://docs.kinora.dev/guides/reporter/)
- [Desktop app guide](https://docs.kinora.dev/guides/desktop/)
- [Open a trace in the browser](https://kinora.dev/trace/)
- [Open the live demo](https://demo.kinora.dev)
- [Star the project on GitHub](https://github.com/kinora-dev/kinora)
