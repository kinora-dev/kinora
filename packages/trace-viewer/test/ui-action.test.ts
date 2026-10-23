import { describe, expect, it } from 'vitest'
import { actionDuration, actionStatus, actionTime, actionTitle, actionTitleParts, filterTree, isSkippedStep } from '../src/ui/lib/action'

type Action = Parameters<typeof actionStatus>[0]

function action(over: Record<string, unknown> = {}): Action {
  return { class: 'Page', method: 'click', params: {}, startTime: 0, endTime: 0, ...over } as unknown as Action
}

describe('actionStatus', () => {
  it('is error when the action has an error message', () => {
    expect(actionStatus(action({ error: { message: 'boom' } }))).toBe('error')
  })

  it('is step for a Test action', () => {
    expect(actionStatus(action({ class: 'Test' }))).toBe('step')
  })

  it('is ok otherwise', () => {
    expect(actionStatus(action())).toBe('ok')
  })
})

describe('actionDuration', () => {
  it('is the elapsed time when both timestamps are present', () => {
    expect(actionDuration(action({ startTime: 100, endTime: 250 }))).toBe(150)
  })

  it('is undefined when an endTime is missing', () => {
    expect(actionDuration(action({ startTime: 100, endTime: 0 }))).toBeUndefined()
  })
})

describe('actionTitle', () => {
  it('returns a non-empty title, falling back to class.method', () => {
    const title = actionTitle(action({ class: 'Page', method: 'click' }))
    expect(typeof title).toBe('string')
    expect(title.length).toBeGreaterThan(0)
  })
})

describe('actionTitleParts', () => {
  it('emphasizes the params substituted into the title', () => {
    const { parts } = actionTitleParts(action({ class: 'Frame', method: 'fill', params: { selector: '#email', value: 'alex@example.com' } }))
    expect(parts.find(p => p.param)?.text).toBe('alex@example.com')
    expect(parts.map(p => p.text).join('')).toBe('Fill "alex@example.com"')
  })

  it('uses the recorded title and its subtitle', () => {
    const { parts, subtitle } = actionTitleParts(action({ class: 'Test', method: 'test.step', title: 'Checkout', subtitle: 'tests/checkout.spec.ts:12' }))
    expect(parts).toEqual([{ text: 'Checkout' }])
    expect(subtitle).toBe('tests/checkout.spec.ts:12')
  })
})

describe('actionTime', () => {
  it('reports unfinished actions', () => {
    expect(actionTime(action({ startTime: 100, endTime: 350 }))).toBe('250ms')
    expect(actionTime(action({ endTime: 0, error: { message: 'Timeout' } }))).toBe('Timed out')
    expect(actionTime(action({ endTime: 0 }))).toBe('-')
  })
})

describe('isSkippedStep', () => {
  it('detects test.step.skip', () => {
    expect(isSkippedStep(action({ class: 'Test', method: 'test.step', annotations: [{ type: 'skip' }] }))).toBe(true)
    expect(isSkippedStep(action({ class: 'Test', method: 'test.step' }))).toBe(false)
  })
})

describe('filterTree', () => {
  const items = [
    { id: 'hooks', depth: 0 },
    { id: 'browser', depth: 1 },
    { id: 'launch', depth: 2 },
    { id: 'click', depth: 0 },
    { id: 'step', depth: 0 },
    { id: 'fill', depth: 1 },
  ]

  it('keeps the ancestors of a match as context', () => {
    expect(filterTree(items, i => i.id === 'launch').map(r => [r.item.id, r.context])).toEqual([
      ['hooks', true],
      ['browser', true],
      ['launch', false],
    ])
  })

  it('does not repeat a shared ancestor and keeps matching ancestors as matches', () => {
    expect(filterTree(items, i => ['step', 'fill', 'click'].includes(i.id)).map(r => [r.item.id, r.context])).toEqual([
      ['click', false],
      ['step', false],
      ['fill', false],
    ])
  })
})
