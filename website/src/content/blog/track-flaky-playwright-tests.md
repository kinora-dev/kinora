---
title: "How to track flaky Playwright tests over time"
description: Retries hide flaky tests and a single report cannot show them. Here is how to spot flaky Playwright tests from their history, tell them apart from broken ones, and keep their identity stable across runs.
date: 2026-10-30
tags:
  - playwright
  - testing
  - ci
  - flaky
slug: track-flaky-playwright-tests
image: /og-image.png
imageAlt: Kinora test history page showing a flaky Playwright test over its last runs
cover: test-history
author:
  name: Joris Gallot
  url: https://jorisgallot.dev
draft: false
---

Every team with a Playwright suite has the same conversation. A test fails in CI, someone re-runs the job, it passes, and the pull request gets merged. Two days later the same test fails on someone else's branch, and the same thing happens again.

Nobody is wrong. Re-running is the fastest way to unblock a merge. But after a few weeks, the suite has a handful of tests that everyone silently ignores, and a red build no longer means much.

The fix starts with a simple question: **is this test flaky, or did my change break it?** A single run cannot answer it. History can.

## What Playwright already tells you

Playwright has a `flaky` status. With `retries` set, a test that fails and then passes on a retry within the same run is reported as flaky instead of passed:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  retries: process.env.CI ? 2 : 0,
})
```

That is useful, and it is the first thing to turn on in CI. But it only sees one run:

- **Retries hide the problem.** A flaky test that passes on its second attempt leaves the build green. Unless someone opens the report, it goes unnoticed.
- **Some flakiness never reaches a retry.** A test that fails on the first attempt of one run and passes on the first attempt of the next is never marked flaky. It just looks like a failure that fixed itself. This is also the default with Vitest browser mode, which runs without retries.
- **A re-run job is a new report.** When you re-run a failed CI job, Playwright produces a fresh report. The failure from the first attempt is gone, along with the evidence that this test is unreliable.

To see flakiness, you need to look at the same test across many runs.

## Flaky or broken: three signals

Looking at a test's last runs, three patterns say "flaky" with different levels of confidence.

**1. It passed and failed on the same commit.** The code did not change, the outcome did. This is the strongest signal. It happens more often than you would think: a re-run in CI, or a branch and its pull request building the same commit.

**2. It needed a retry to pass.** Playwright's own `flaky` status. Once is noise; a few times out of twenty runs is a pattern.

**3. It keeps flipping between pass and fail.** Pass, fail, pass, fail, on different commits. One bad run between two good ones is not enough: that is often a regression that the next commit fixed. Three flips or more is hard to explain any other way.

A **broken** test is the opposite case: it failed and keeps failing. If a test has failed on its last three runs, it does not matter that it flaked a month ago. It no longer passes, something broke it, and the useful piece of information is the first run of that failing streak, and its commit.

The distinction matters because the two call for different actions. A broken test needs a fix in the code or the test, today. A flaky test needs to be stabilized, and until then it should stop blocking everyone else.

## The part that breaks quietly: test identity

All of this assumes you can recognize "the same test" across runs. That sounds obvious, until you ask what identifies a test.

In Playwright, a reasonable identity is the combination of:

- the spec file, relative to the `testDir`
- the full title path (`describe` blocks plus the test title)
- the Playwright project name (`chromium`, `webkit`, `mobile`...)

The project name matters: a test that is flaky only on WebKit is a different problem from one that is flaky everywhere, and mixing them hides it.

The consequence is that some harmless-looking changes reset history. Rename a spec file, move it to another folder, change a `describe` title, rename a Playwright project or move the `testDir`, and every affected test becomes a new test with no past. The old one stops receiving results and slowly disappears from the window.

You cannot avoid this entirely, and you should not refuse to rename things because of it. But it is worth knowing when you clean up a test suite: a big reorganization costs you a few weeks of flakiness data. Do it in one go rather than spread over many small changes.

## Doing this with Kinora

[Kinora](https://kinora.dev) is an open source dashboard that keeps the history of your Playwright runs. It applies the rules above to every test, over its last 20 runs, and flags it as **Flaky** or **Broken** with the reason in plain words: "Passed and failed on the same commit a1b2c3d", "Needed a retry to pass in 4 runs of the last 20", or "Failing on its last 3 runs, since commit e4f5a6b".

The setup is a reporter next to your current one:

```bash
npm i -D @kinora/reporter
```

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ['html'],
    ['@kinora/reporter', { project: { slug: 'web-app' } }],
  ],
})
```

The reporter reads the commit and branch from the CI environment, which is what makes the "same commit" signal work. Sharded runs are assembled into one run, and a test that failed and then passed when you re-ran its shard is kept as flaky instead of being overwritten.

A few things then become part of the daily routine:

**The Tests page shows what needs attention.** By default it lists the flaky and broken tests of the project, and marks the ones that started failing or flaking in their last 5 runs as **New failure** or **New flakiness**. Those are the ones a recent change most likely caused.

**Each test has a timeline.** Its page shows its pass, flaky and fail rates and its runs as a strip of statuses, along with the reason for its verdict and the commit where a broken streak started. From any run, the trace of the failure opens inline: DOM snapshots, network, console, without downloading a CI artifact.

**Flaky tests can be quarantined.** Quarantining a test, with a reason, mutes its alerts and gives it its own tab on the run page, so the rest of the suite stays readable while someone works on it. The test still runs and its history keeps growing, so you can see when the fix actually worked.

## A routine that works

Tools help, but the habit is what keeps a suite healthy. What I would suggest for a team:

1. **Turn on retries in CI**, so a flaky test does not block a merge.
2. **Review the flaky list once a week**, not every time a build goes red. Pick the worst one and give it an owner.
3. **Quarantine instead of `test.skip`.** A skipped test stops producing data; a quarantined one keeps telling you whether it is getting better.
4. **Fix broken tests immediately.** They are not flaky, and treating them as such is how real regressions ship.

## Try it

- [Flaky and broken tests guide](https://docs.kinora.dev/guides/flaky-tests/)
- [Playwright reporter guide](https://docs.kinora.dev/guides/reporter/)
- [Open the live demo](https://demo.kinora.dev)
- [Star the project on GitHub](https://github.com/kinora-dev/kinora)
