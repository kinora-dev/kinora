import type { TestHistory, TestPoint } from '../contracts/kinora'
import { describe, expect, it } from 'vitest'
import { buildComponents, storiesOf, STORY_ANNOTATION, storyLabel } from './story'

function point(runId: string, status: TestPoint['status']): TestPoint {
  return { runId, startedAt: `2026-01-0${runId.slice(1)}T00:00:00Z`, status, duration: 100, retries: status === 'flaky' ? 1 : 0 }
}

function history(testKey: string, stories: string[] | undefined, points: TestPoint[]): TestHistory {
  return {
    testKey,
    title: testKey,
    titlePath: ['f.spec.ts', testKey],
    file: 'f.spec.ts',
    projectName: 'components',
    stories,
    points,
    runs: points.length,
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    executed: 0,
    flakyRate: 0,
    failRate: 0,
    passRate: 1,
    recentFlakyRate: 0,
    recentFailRate: 0,
    newlyFlaky: false,
    newlyBroken: false,
    lastStatus: points.at(-1)?.status ?? 'expected',
  }
}

describe('storiesOf', () => {
  it('keeps distinct story ids and ignores other annotations', () => {
    expect(storiesOf({
      annotations: [
        { type: 'skip', description: 'Button/Primary' },
        { type: STORY_ANNOTATION, description: 'Button/Primary' },
        { type: STORY_ANNOTATION, description: 'Button/Disabled' },
        { type: STORY_ANNOTATION, description: 'Button/Primary' },
        { type: STORY_ANNOTATION },
      ],
    })).toEqual(['Button/Primary', 'Button/Disabled'])
  })
})

describe('storyLabel', () => {
  it('keeps the component and the story name', () => {
    expect(storyLabel('components/Button/Primary')).toBe('Button / Primary')
    expect(storyLabel('Button/Primary')).toBe('Button / Primary')
    expect(storyLabel('Primary')).toBe('Primary')
  })
})

describe('buildComponents', () => {
  it('ignores tests that mount no story', () => {
    expect(buildComponents([history('e2e', undefined, [point('r1', 'expected')]), history('empty', [], [])])).toEqual([])
  })

  it('groups stories under their component, sorted by name', () => {
    const components = buildComponents([
      history('a', ['components/Card/Default'], [point('r1', 'expected')]),
      history('b', ['components/Button/Primary'], [point('r1', 'expected')]),
      history('c', ['components/Button/Disabled'], [point('r1', 'expected')]),
    ])
    expect(components.map(c => [c.path, c.name, c.stories.map(s => s.name)])).toEqual([
      ['components/Button', 'Button', ['Disabled', 'Primary']],
      ['components/Card', 'Card', ['Default']],
    ])
    expect(components[0].stories[1].id).toBe('components/Button/Primary')
  })

  it('keeps same-named components from different folders apart', () => {
    const components = buildComponents([
      history('a', ['forms/Button/Primary'], [point('r1', 'expected')]),
      history('b', ['nav/Button/Primary'], [point('r1', 'expected')]),
    ])
    expect(components.map(c => c.path)).toEqual(['forms/Button', 'nav/Button'])
  })

  it('puts a single-segment story id in a nameless component', () => {
    const [component] = buildComponents([history('a', ['Primary'], [point('r1', 'expected')])])
    expect(component).toMatchObject({ path: '', name: '' })
    expect(component.stories[0]).toMatchObject({ id: 'Primary', name: 'Primary' })
  })

  it('merges a suffix id into the full id it points at', () => {
    const components = buildComponents([
      history('a', ['components/Button/Primary'], [point('r1', 'expected')]),
      history('b', ['Button/Primary'], [point('r1', 'unexpected')]),
    ])
    expect(components).toHaveLength(1)
    expect(components[0].stories).toHaveLength(1)
    expect(components[0].stories[0]).toMatchObject({ id: 'components/Button/Primary', lastStatus: 'unexpected' })
    expect(components[0].stories[0].tests.map(t => t.testKey)).toEqual(['a', 'b'])
  })

  it('leaves an ambiguous suffix id alone', () => {
    const components = buildComponents([
      history('a', ['forms/Button/Primary'], [point('r1', 'expected')]),
      history('b', ['nav/Button/Primary'], [point('r1', 'expected')]),
      history('c', ['Button/Primary'], [point('r1', 'expected')]),
    ])
    expect(components.map(c => c.path)).toEqual(['Button', 'forms/Button', 'nav/Button'])
  })

  it('folds the tests of a story into one point per run with the worst status', () => {
    const [component] = buildComponents([
      history('a', ['Button/Primary'], [point('r2', 'expected'), point('r1', 'expected')]),
      history('b', ['Button/Primary'], [point('r1', 'flaky'), point('r2', 'unexpected'), point('r3', 'skipped')]),
    ])
    const [story] = component.stories
    expect(story.points.map(p => [p.runId, p.status])).toEqual([['r1', 'flaky'], ['r2', 'unexpected'], ['r3', 'skipped']])
    expect(story.points[0]).toMatchObject({ duration: 200, retries: 1 })
    expect(story.lastStatus).toBe('skipped')
  })

  it('counts a test that mounts several stories for each of them', () => {
    const components = buildComponents([
      history('both', ['Button/Primary', 'Button/Disabled'], [point('r1', 'unexpected')]),
      history('one', ['Card/Default'], [point('r1', 'expected')]),
    ])
    const button = components.find(c => c.name === 'Button')
    expect(button?.stories.map(s => [s.name, s.lastStatus])).toEqual([['Disabled', 'unexpected'], ['Primary', 'unexpected']])
    expect(button?.lastStatus).toBe('unexpected')
    expect(components.find(c => c.name === 'Card')?.lastStatus).toBe('expected')
  })
})
