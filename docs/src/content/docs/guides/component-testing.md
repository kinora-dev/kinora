---
title: Component testing
description: Upload Playwright component tests to kinora and record which story each test mounted.
---

Playwright's built-in component testing (the `mount` fixture, stories, and a gallery page) runs
through the regular test runner, so component tests upload like any other test: same
[reporter](/guides/reporter/) or [CLI](/guides/cli/), same history, same traces. Nothing to
configure.

What kinora cannot see on its own is **which story a test mounted**. Import `test` from
`@kinora/reporter/ct` and it records it for you.

## Requirements

- `@playwright/test` >=1.63 (the first version with the built-in `mount` fixture).
- A working component testing setup: see the
  [Playwright guide](https://playwright.dev/docs/test-components).

## Usage

Import `test` and `expect` from `@kinora/reporter/ct` instead of `@playwright/test`:

```ts
import { expect, test } from '@kinora/reporter/ct'

test('disabled button is disabled', async ({ mount }) => {
  const component = await mount('components/Button/Disabled')
  await expect(component.getByRole('button')).toBeDisabled()
})
```

`mount` behaves exactly like Playwright's, typings included. Each story id it mounts is added to
the test as a `kinora:story` annotation, which travels with the results on both upload paths.

Already extending `test` with your own fixtures? Extend this one instead:

```ts
import { test as base } from '@kinora/reporter/ct'

export const test = base.extend({
  // your fixtures
})
```

## Notes

- A test that mounts several stories records each of them once.
- The story is recorded before it renders, so a story that fails to mount is still attributed.
- Uploading with the [CLI](/guides/cli/)? Keep the import: the annotations are in Playwright's
  JSON report, so the CLI picks them up too.
