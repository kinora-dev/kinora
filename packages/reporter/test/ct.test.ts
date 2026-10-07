import { STORY_ANNOTATION } from '@kinora/core'
import { describe, expect, it, vi } from 'vitest'
import { recordStory, withStoryAnnotations } from '../src/ct'

describe('recordStory', () => {
  it('adds one annotation per distinct story', () => {
    const annotations = [{ type: 'issue', description: 'Button/Primary' }]
    recordStory(annotations, 'Button/Primary')
    recordStory(annotations, 'Button/Disabled')
    recordStory(annotations, 'Button/Primary')
    expect(annotations).toEqual([
      { type: 'issue', description: 'Button/Primary' },
      { type: STORY_ANNOTATION, description: 'Button/Primary' },
      { type: STORY_ANNOTATION, description: 'Button/Disabled' },
    ])
  })
})

describe('withStoryAnnotations', () => {
  it('forwards the call and returns the mount result', async () => {
    const mount = vi.fn(async (_storyId: string, _props?: Record<string, unknown>) => 'locator')
    const annotations: { type: string, description?: string }[] = []
    await expect(withStoryAnnotations(mount, annotations)('Button/WithTitle', { title: 'Hi' })).resolves.toBe('locator')
    expect(mount).toHaveBeenCalledWith('Button/WithTitle', { title: 'Hi' })
    expect(annotations).toEqual([{ type: STORY_ANNOTATION, description: 'Button/WithTitle' }])
  })

  it('records the story even when mounting fails', async () => {
    const mount = vi.fn(async (_storyId: string) => {
      throw new Error('Unknown story')
    })
    const annotations: { type: string, description?: string }[] = []
    await expect(withStoryAnnotations(mount, annotations)('Nope/Missing')).rejects.toThrow('Unknown story')
    expect(annotations).toEqual([{ type: STORY_ANNOTATION, description: 'Nope/Missing' }])
  })
})
