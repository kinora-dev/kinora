---
title: "Storybook and Vitest in CI: test history per component"
description: Storybook and Vitest browser tests tell you what broke in one run. Here is how to keep their history per component and per story in CI, with flaky detection, traces, screenshot diffs and accessibility checks.
date: 2026-10-11
updatedDate: 2026-11-26
tags:
  - vitest
  - storybook
  - testing
  - playwright
slug: component-health-vitest-storybook
image: /og-image.png
imageAlt: Kinora Components page showing the health of each story over the last runs
cover: components
author:
  name: Joris Gallot
  url: https://jorisgallot.dev
draft: false
---

Component tests have become real browser tests. Vitest browser mode runs them in Chromium through Playwright, and Storybook's Vitest addon turns every story into a test. They are fast, they render the real thing, and most design systems now have hundreds of them.

What they still lack is memory.

A run tells you that 3 tests failed out of 400. It does not tell you:

- Which components are those 3 tests about?
- Was the `Select` story already failing yesterday, or did it break with this pull request?
- Which stories fail once in a while and pass on retry?
- What did the component look like when the screenshot assertion failed in CI?

The output is a list of tests. The thing you care about is a list of components.

## A test is not a component

Test runners report by file and by test title. That is the right unit for running tests, but not for reading the state of a design system.

One story is often covered by several tests: a render check, an interaction, a visual assertion. One test file often covers several stories. When something fails, you have to map the test title back to a component in your head, then go look for the previous runs to know whether it is new.

Storybook already gives you the right unit, the story. `Button/Primary` means something to everyone on the team, designers included. So the useful question is simple: for each story, what happened in the last runs?

## Sending Vitest and Storybook results to Kinora

[Kinora](https://kinora.dev) started as a dashboard for Playwright reports. It now takes Vitest runs too, through a reporter you add next to the default one:

```bash
pnpm add -D @kinora/vitest-reporter
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    reporters: ['default', ['@kinora/vitest-reporter', { project: { slug: 'design-system' } }]],
  },
})
```

Then run your tests with an API token in the environment:

```bash
KINORA_TOKEN=<token> npx vitest run
```

Three things are worth knowing about how it behaves.

**It uploads browser tests only, by default.** Node unit tests are usually thousands of fast, deterministic tests with no trace. They add little to a dashboard, so the reporter skips them unless you set `include: 'all'`.

**With Storybook's Vitest addon, there is nothing else to do.** Each story is already a Vitest test, and the reporter records which story each test renders, as `<Component>/<Story>`.

**An upload never fails your test run.** If the server is unreachable, your tests still pass or fail on their own merits.

Sharded runs need nothing either. With `vitest --shard=1/4`, each shard uploads on its own and Kinora assembles the shards of one CI run into a single run.

## One page per design system

Once a run with stories is uploaded, the project gets a Components page. Stories are grouped by component, and each story shows:

- its latest status
- a timeline over the last 20 runs
- the tests that render it

A story's status in a run is the worst status among its tests in that run. If the render check passes and the interaction test fails, the story is failing.

The timeline is what changes the conversation. A story that is red in the latest run and green in the 19 before it is a regression, and the pull request is the suspect. A story that goes red every few runs is flaky, and the pull request is probably innocent.

Kinora also does that reading for you. Each story is flagged **Flaky** or **Broken** with the same rules as the Tests page, and a filter narrows the page to the stories that need attention. This matters more with Vitest than with Playwright: Vitest runs without retries by default, so a flaky story is never marked as such within a single run. It only shows across runs, as described in [how to track flaky tests over time](/blog/track-flaky-playwright-tests).

## What it looked like when it failed

History tells you when a story broke. You still need to see why.

With the Playwright provider, Vitest browser mode can record a Playwright trace per test:

```ts
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

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

The reporter uploads the `trace.zip` of each failing test, and Kinora opens it in its embedded trace viewer: DOM snapshots, console, network, right from the failed test. No artifact to download from CI, which is otherwise [more steps than it should be](/blog/open-playwright-trace-from-ci).

Visual assertions get the same treatment. A failing `toMatchScreenshot` uploads its reference, actual and diff images, and the run page shows them as a screenshot comparison. You see the two pixels of padding that moved before you even check out the branch.

## Accessibility, per story

If you use Storybook's [a11y addon](https://storybook.js.org/docs/writing-tests/accessibility-testing), each story's axe check is uploaded with its test: the rules it breaks, their impact, the elements they hit, and a link to each rule's documentation.

On the Components page, each story shows how many rules it breaks, and **Accessibility hotspots** ranks components by their stories' violations, weighted by impact. On a design system with a few hundred stories, that tells you which component to fix first.

The addon's `a11y.test` parameter decides how a violation counts:

```ts
// .storybook/preview.ts
export default {
  parameters: {
    a11y: { test: 'todo' },
  },
}
```

With `'todo'`, the test passes and the violations are recorded as warnings, impact included. With `'error'`, the test fails, and Kinora reads the violations from the failure message instead, without their impact. If your CI does not need to fail on violations, `'todo'` gives you the full picture without blocking anyone.

## On the pull request

History is useful when you go looking for it. On a pull request, the question is narrower: did this change break a component?

The reporter can answer it where the review happens:

```ts
['@kinora/vitest-reporter', {
  project: { slug: 'design-system' },
  prComment: true,
  prStatus: true,
}]
```

`prComment` posts a summary comment on the GitHub pull request or GitLab merge request, and keeps it updated. `prStatus` sets a `kinora / design-system` commit status that is red only when the pull request breaks something: a test failing on the branch that passed on the base branch. A story that was already failing on `main` does not turn your pull request red. The [PR comments guide](https://docs.kinora.dev/guides/pr-comments/) has the CI permissions to set.

## Not on Vitest? Playwright component tests work too

If your component tests run on Playwright's own `mount` fixture, they already upload like any other Playwright test. The only missing piece is which story a test mounted, and one import records it:

```ts
import { expect, test } from '@kinora/reporter/ct'

test('disabled button is disabled', async ({ mount }) => {
  const component = await mount('Button/Disabled')
  await expect(component.getByRole('button')).toBeDisabled()
})
```

Stories from both paths land on the same Components page. This is the setup I use for Kinora's own design system, and the [component testing guide](https://docs.kinora.dev/guides/component-testing/) has the full Vue and Vite example to copy.

## Two limits to know about

**A test that renders several stories counts for each of them.** Kinora knows which stories a test mounted, not which one an assertion failed on. A failure marks all of them as failing. Keep one story per test when you want precise attribution.

**Storybook `play` functions are not Playwright actions.** The trace of a Storybook test shows the rendered story, not each interaction step.

## Asking an agent instead of reading the page

The same data is available to coding agents through Kinora's MCP server. Its `component_health` tool answers questions like "which stories of `Dialog` are failing or flaky, and which tests render them?". That is a much better starting point for an agent than a raw test log.

## Try it

If you already run Vitest in browser mode or Storybook tests in CI, the setup is one dependency and one line in your config.

- [Vitest and Storybook guide](https://docs.kinora.dev/guides/vitest/)
- [Component testing guide](https://docs.kinora.dev/guides/component-testing/)
- [PR comments and commit status](https://docs.kinora.dev/guides/pr-comments/)
- [Open the live demo](https://demo.kinora.dev)
- [Star the project on GitHub](https://github.com/kinora-dev/kinora)
