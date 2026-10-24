import type { ActionEntry } from '../src/core/isomorphic/trace/entries'
import { describe, expect, it } from 'vitest'
import { actionLogLines } from '../src/ui/lib/action'
import { callSummary, callValue, expectedTextValue, parseSerializedValue, stringifyCallValue } from '../src/ui/lib/call'

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
      { key: 'locator', value: `locator('#complete')`, copyable: true },
      { key: 'timeout', value: '5000', copyable: true },
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
    expect(summary.primary.map(row => row.key)).toEqual(['locator', 'expression', 'expected text'])
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
    expect(summary.result).toEqual([{ key: 'ok', value: 'true', copyable: true }])
  })

  it('fills the title template like the action list', () => {
    const summary = callSummary(action({ title: 'Fill "{value}"', params: { value: 'alex@example.com' } }))
    expect(summary.title).toBe('Fill "alex@example.com"')
  })
})

describe('callSummary times', () => {
  it('starts relative to the trace and reports unfinished calls', () => {
    expect(callSummary(action({ startTime: 1250 }), { startTime: 1000 }).start).toBe('250ms')
    expect(callSummary(action({ endTime: 0 })).duration).toBe('Running')
    expect(callSummary(action({ endTime: 0, error: { message: 'Timeout' } as any })).duration).toBe('Timed out')
  })

  it('renders the locator in the trace language and hides waitForEventInfo', () => {
    const summary = callSummary(action({ params: { selector: 'internal:role=button[name="Pay"i]', info: { waitId: 'x' } } }), { sdkLanguage: 'python' })
    expect(summary.primary[0]).toEqual({ key: 'locator', value: 'get_by_role("button", name="Pay")', copyable: true })
    expect(summary.params).toEqual([])
  })
})

describe('callValue', () => {
  it('decodes serialized eval arguments and results', () => {
    const evaluate = action({ class: 'Frame', method: 'evaluateExpression' })
    expect(callValue(evaluate, 'arg', { value: { o: [{ k: 'id', v: { n: 7 } }, { k: 'el', v: { h: 0 } }] } }).value).toBe(`{
  "id": 7,
  "el": "<handle>"
}`)
    expect(callValue(evaluate, 'value', { s: 'done' })).toEqual({ key: 'value', value: 'done', copyable: true })
  })

  it('unwraps the received value of expect calls', () => {
    const expectCall = action({ method: 'expect' })
    expect(callValue(expectCall, 'received', { value: { b: false }, ariaSnapshot: '- button' }).value).toBe('false')
    expect(callValue(expectCall, 'received', { s: 'Order' }).value).toBe('Order')
  })

  it('shows handles and files as placeholders without a copy button', () => {
    expect(callValue(action(), 'element', { guid: 'element@1' })).toEqual({ key: 'element', value: '<handle>' })
    expect(callValue(action(), 'files', [{ name: 'a.png' }])).toEqual({ key: 'files', value: '<files>' })
  })
})

describe('parseSerializedValue', () => {
  it('decodes special values, dates and regexes', () => {
    expect(parseSerializedValue({ v: 'NaN' })).toBeNaN()
    expect(parseSerializedValue({ v: 'null' })).toBeNull()
    expect(parseSerializedValue({ a: [{ n: 1 }, { v: 'undefined' }] })).toEqual([1, undefined])
    expect(String(parseSerializedValue({ r: { p: 'ab+', f: 'i' } }))).toBe('/ab+/i')
    expect(parseSerializedValue({ d: '2026-01-02T00:00:00.000Z' })).toEqual(new Date('2026-01-02T00:00:00.000Z'))
  })
})

describe('actionLogLines', () => {
  it('times each line until the next one and the last until the action ends', () => {
    const lines = actionLogLines(action({
      endTime: 400,
      log: [
        { time: 100, message: 'waiting for locator' },
        { time: 150, message: 'locator resolved' },
        { time: -1, message: 'untimed' },
      ] as any,
    }))
    expect(lines.map(line => line.duration)).toEqual(['50ms', '250ms', ''])
    expect(actionLogLines(action({ endTime: 0, log: [{ time: 100, message: 'waiting' }] as any }))[0].duration).toBe('-')
  })
})
