import type { ActionEntry } from '../src/core/isomorphic/trace/entries'
import { describe, expect, it } from 'vitest'
import { callSummary, expectedTextValue, stringifyCallValue } from '../src/ui/lib/call'

function action(over: Partial<ActionEntry> = {}): ActionEntry {
  return {
    type: 'action',
    callId: 'call@1',
    startTime: 100,
    endTime: 125,
    class: 'Frame',
    method: 'click',
    params: {},
    log: [],
    ...over,
  } as ActionEntry
}

describe('stringifyCallValue', () => {
  it('keeps strings as-is and pretty-prints objects', () => {
    expect(stringifyCallValue('hello')).toBe('hello')
    expect(stringifyCallValue({ a: 1 })).toBe(`{
  "a": 1
}`)
    expect(stringifyCallValue(undefined)).toBe('undefined')
  })
})

describe('expectedTextValue', () => {
  it('extracts Playwright expectedText entries', () => {
    expect(expectedTextValue([{ string: 'Order complete' }])).toBe('Order complete')
    expect(expectedTextValue(['one', { string: 'two' }])).toBe('one\ntwo')
    expect(expectedTextValue(undefined)).toBeUndefined()
  })
})

describe('callSummary', () => {
  it('summarizes primary action details', () => {
    const summary = callSummary(action({ params: { selector: '#complete', timeout: 5000 } }))
    expect(summary.title).toContain('Click')
    expect(summary.subtitle).toBe('Frame.click')
    expect(summary.duration).toBe('25ms')
    expect(summary.primary).toEqual([
      { key: 'selector', value: '#complete' },
      { key: 'timeout', value: '5000' },
    ])
  })

  it('promotes expected text for expect calls', () => {
    const summary = callSummary(action({
      method: 'expect',
      params: {
        selector: '#title',
        expression: 'to.have.text',
        expectedText: [{ string: 'Order complete', normalizeWhiteSpace: true }],
      },
    }))
    expect(summary.primary.map(row => row.key)).toEqual(['selector', 'expression', 'expected text'])
    expect(summary.primary.at(-1)?.value).toBe('Order complete')
    expect(summary.params).toEqual([])
  })

  it('surfaces errors and results', () => {
    const summary = callSummary(action({
      error: { message: `Error: ${String.fromCharCode(0x1B)}[31mboom${String.fromCharCode(0x1B)}[22m` } as any,
      result: { ok: true },
    }))
    expect(summary.status).toBe('error')
    expect(summary.error).toBe('Error: boom')
    expect(summary.result).toContain('"ok": true')
  })
})
