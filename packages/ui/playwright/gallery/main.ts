/// <reference types="vite/client" />
import type { App, Component } from 'vue'
import { createApp, h, nextTick, shallowRef } from 'vue'
import './style.css'

// The page behind Playwright's `mount` fixture: it exposes window.mount / window.unmount and
// renders one story at a time into #root. A story is a named export of a `*.story.ts` file
// sitting next to its component; its id is `<file name>/<export>`, e.g. `Button/Primary`.
interface MountParams { story: string, props?: Record<string, unknown> }

declare global {
  interface Window {
    mount: (params: MountParams) => Promise<void>
    unmount: () => Promise<void>
  }
}

const modules = import.meta.glob<Record<string, Component>>('../../src/**/*.story.ts', { eager: true })
const stories = new Map<string, Component>()
for (const [file, exports] of Object.entries(modules)) {
  const component = file.slice(file.lastIndexOf('/') + 1).replace('.story.ts', '')
  for (const [name, story] of Object.entries(exports))
    stories.set(`${component}/${name}`, story)
}

const current = shallowRef<Component>()
const currentProps = shallowRef<Record<string, unknown>>({})
let app: App | undefined

window.mount = async ({ story, props }) => {
  const component = stories.get(story)
  if (!component)
    throw new Error(`Unknown story "${story}". Known stories: ${[...stories.keys()].join(', ')}`)
  current.value = component
  currentProps.value = props ?? {}
  // One app for the page's lifetime: a second mount() of the same story (component.update)
  // re-renders in place and keeps the story's state.
  if (!app) {
    app = createApp({ render: () => (current.value ? h(current.value, currentProps.value) : null) })
    app.mount('#root')
  }
  await nextTick()
}

window.unmount = async () => {
  app?.unmount()
  app = undefined
  current.value = undefined
}
