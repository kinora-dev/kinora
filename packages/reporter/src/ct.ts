import type { TestInfo } from '@playwright/test'
import { STORY_ANNOTATION } from '@kinora/core'
import { test as base } from '@playwright/test'

export { expect } from '@playwright/test'

type Annotations = TestInfo['annotations']

// One annotation per distinct story, however many times the test mounts it.
export function recordStory(annotations: Annotations, storyId: string): void {
  if (!annotations.some(a => a.type === STORY_ANNOTATION && a.description === storyId))
    annotations.push({ type: STORY_ANNOTATION, description: storyId })
}

// Recorded before mounting so a story that fails to render is still attributed.
export function withStoryAnnotations<M extends (storyId: string, ...rest: any[]) => unknown>(mount: M, annotations: Annotations): M {
  return ((storyId: string, ...rest: any[]) => {
    recordStory(annotations, storyId)
    return mount(storyId, ...rest)
  }) as M
}

/**
 * Drop-in replacement for `test` from `@playwright/test` in component tests: `mount` records
 * the mounted story id on the test, which lets kinora group results by component and story.
 */
export const test = base.extend({
  mount: async ({ mount }, use, testInfo) => {
    await use(withStoryAnnotations(mount, testInfo.annotations))
  },
})
