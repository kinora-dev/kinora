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
  [Playwright guide](https://playwright.dev/docs/test-components), or the
  [Vue and Vite example](#example-vue-and-vite) below.

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

## The Components view

Once a run with recorded stories is uploaded, the project's **Components** page (linked from the
project page) groups them by component: `components/Button/Primary` is the `Primary` story of
`Button`. Each story shows its latest status, a timeline over the last 20 runs, and the tests
that mount it.

- A story's status in a run is the worst status among its tests in that run.
- Playwright accepts any unique suffix of a story id, so `Button/Primary` and
  `components/Button/Primary` are shown as one story.
- **A test that mounts several stories counts for each of them.** kinora knows which stories a
  test mounted, not which one an assertion failed on, so a failure marks all of that test's
  stories as failing. Keep one story per test when you want precise attribution.

## Example: Vue and Vite

Playwright leaves the gallery page to you. This is the setup kinora uses for its own design
system ([`packages/ui`](https://github.com/kinora-dev/kinora/tree/main/packages/ui)), which you
can copy as a starting point. It is five small pieces.

**A story** is a named export next to its component. Render functions keep it a plain `.ts` file:

```ts
// src/components/Button.story.ts
import { defineComponent, h, ref } from 'vue'
import Button from './Button.vue'

export const Primary = () => h(Button, null, () => 'Save changes')

export const Disabled = () => h(Button, { disabled: true }, () => 'Save changes')

// The story owns the handler and records its effect in the DOM for the test to read.
export const CountsClicks = defineComponent(() => {
  const clicks = ref(0)
  return () => [
    h(Button, { onClick: () => clicks.value++ }, () => 'Click me'),
    h('output', { 'data-testid': 'clicks' }, String(clicks.value)),
  ]
})
```

**The gallery** collects every story and exposes the two functions Playwright's `mount` calls.
Serve it with Vite from an `index.html` that holds a `<div id="root">` and loads this module:

```ts
// playwright/gallery/main.ts
import type { App, Component } from 'vue'
import { createApp, h, nextTick, shallowRef } from 'vue'
import '../../src/style.css' // the same global styles as your app

declare global {
  interface Window {
    mount: (params: { story: string, props?: Record<string, unknown> }) => Promise<void>
    unmount: () => Promise<void>
  }
}

const modules = import.meta.glob<Record<string, Component>>('../../src/**/*.story.ts', { eager: true })
const stories = new Map<string, Component>()
for (const [file, exports] of Object.entries(modules)) {
  const component = file.slice(file.lastIndexOf('/') + 1).replace('.story.ts', '')
  for (const [name, story] of Object.entries(exports))
    stories.set(`${component}/${name}`, story) // "Button/Primary"
}

const current = shallowRef<Component>()
const currentProps = shallowRef<Record<string, unknown>>({})
let app: App | undefined

window.mount = async ({ story, props }) => {
  const component = stories.get(story)
  if (!component)
    throw new Error(`Unknown story "${story}"`)
  current.value = component
  currentProps.value = props ?? {}
  // One app for the page: mounting the same story again re-renders in place and keeps its state.
  if (!app) {
    app = createApp({ render: () => (current.value ? h(current.value, currentProps.value) : null) })
    app.mount('#root')
  }
  await nextTick()
}

window.unmount = async () => {
  app?.unmount()
  app = undefined
}
```

**A Vite config** serves that folder on a fixed port:

```ts
// vite.gallery.config.ts
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'playwright/gallery',
  plugins: [vue()], // plus whatever your app's own Vite config uses, such as Tailwind
  server: { port: 5398, strictPort: true },
})
```

**The Playwright config** starts the gallery and points `baseURL` at it:

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

const gallery = 'http://localhost:5398/'

export default defineConfig({
  testDir: './tests/components',
  webServer: {
    command: 'vite --config vite.gallery.config.ts --force',
    url: gallery,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{
    name: 'components',
    use: { ...devices['Desktop Chrome'], baseURL: gallery, reuseContext: true },
  }],
})
```

**A test** mounts a story by its id and asserts like any Playwright test:

```ts
// tests/components/button.spec.ts
import { expect, test } from '@kinora/reporter/ct'

test('emits a click per press', async ({ mount }) => {
  const component = await mount('Button/CountsClicks')
  await component.getByRole('button', { name: 'Click me' }).click()
  await expect(component.getByTestId('clicks')).toHaveText('1')
})
```

### Things that will trip you up

- **"The gallery page does not define window.mount()"** on the first tests of a run. Vite found
  new dependencies while the tests were running and reloaded the page. Start the gallery with
  `--force`, as above, so its dependency cache is rebuilt before the first test.
- **Dialogs, menus, popovers and tooltips are not inside the mounted component.** Libraries
  render them at the end of `<body>`, outside the gallery root that `mount` returns. Query them
  from `page`: `page.getByRole('dialog')`, not `component.getByRole('dialog')`.
- **Clicking outside an overlay right after it opens may do nothing.** Many libraries start
  listening for outside clicks a tick after opening. Wrap the click and its assertion in
  `expect(async () => { ... }).toPass()`.
- **Keep story ids short.** The Components page names a component after the segment before the
  story name, so `Button/Primary` reads better than a full source path. The gallery decides the
  id, as in the example above.

## Visual tests

`toHaveScreenshot` works on a mounted story like on any locator, and a failure shows up in kinora
as a [screenshot comparison](/guides/reporter/#screenshot-comparisons):

```ts
test('primary button', async ({ mount }) => {
  await expect(await mount('Button/Primary')).toHaveScreenshot('button-primary.png')
})
```

The catch is the reference images. A browser on macOS does not draw text exactly like the same
browser on Linux, so images generated on a laptop fail in CI, and the other way round. The fix is
to always render them with the same browser: the one in Playwright's official Docker image.

Only the browser needs to be in the container. Start a Playwright server in it and point your
usual test command at it:

```bash
docker run --rm --ipc=host -p 3000:3000 --add-host=host.docker.internal:host-gateway \
  mcr.microsoft.com/playwright:v1.63.0-noble \
  npx -y playwright@1.63.0 run-server --port 3000 --host 0.0.0.0

PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:3000/ npx playwright test
```

Three details make it work:

- **The image tag and the `playwright@` version must match your installed `@playwright/test`.**
- **The browser is in the container, your gallery is on the host.** Use
  `http://host.docker.internal:<port>/` as `baseURL`, and let the dev server listen on all
  interfaces and accept that host name (Vite: `server.host` and `server.allowedHosts`).
- **Drop the platform from the snapshot path**, since one image now serves every OS:
  `snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}'`.

kinora wraps these steps in a script for its own design system:
[`packages/ui/scripts/visual.mjs`](https://github.com/kinora-dev/kinora/blob/main/packages/ui/scripts/visual.mjs).

## Notes

- A test that mounts several stories records each of them once.
- The story is recorded before it renders, so a story that fails to mount is still attributed.
- Uploading with the [CLI](/guides/cli/)? Keep the import: the annotations are in Playwright's
  JSON report, so the CLI picks them up too.
