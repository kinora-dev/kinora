import { describe, expect, it } from 'vitest'
import { ansiSegments } from '../src/ui/lib/ansi'
import { consoleEntries, formatConsoleArgs, parseConsoleCss } from '../src/ui/lib/console'

const ESC = String.fromCharCode(0x1B)

describe('ansiSegments', () => {
  it('maps colours and styles onto the theme and resets them', () => {
    expect(ansiSegments(`${ESC}[1;31mfailed${ESC}[0m done`)).toEqual([
      { text: 'failed', style: { fontWeight: 'bold', color: 'var(--fail)' } },
      { text: ' done' },
    ])
    expect(ansiSegments(`${ESC}[32mok${ESC}[39m`)).toEqual([{ text: 'ok', style: { color: 'var(--pass)' } }])
  })

  it('keeps plain text as one segment', () => {
    expect(ansiSegments('plain')).toEqual([{ text: 'plain' }])
  })
})

describe('parseConsoleCss', () => {
  it('keeps text styling and drops properties that could escape the line', () => {
    expect(parseConsoleCss('color: rgb(255, 0, 0); font-weight: bold; position: fixed; background: url(x)')).toEqual({
      color: 'rgb(255, 0, 0)',
      fontWeight: 'bold',
      background: 'url(x)',
    })
  })
})

describe('formatConsoleArgs', () => {
  const arg = (value: unknown, preview = String(value)) => ({ preview, value })

  it('substitutes %s and styles text after %c', () => {
    expect(formatConsoleArgs([arg('%cstyled%c plain %s'), arg('color: red'), arg(''), arg('value')])).toEqual([
      { text: 'styled', style: { color: 'red' } },
      { text: ' plain ' },
      { text: 'value' },
    ])
  })

  it('appends extra args and colours non-string values', () => {
    expect(formatConsoleArgs([arg('payment failed'), arg({ code: 1 }, '{code: 1}')])).toEqual([
      { text: 'payment failed' },
      { text: ' ' },
      { text: '{code: 1}', style: { color: 'var(--code-number)' } },
    ])
  })
})

describe('consoleEntries', () => {
  const log = (text: string, time: number, pageId = 'page@1') => ({
    type: 'console',
    messageType: 'log',
    text,
    args: [{ preview: text, value: text }],
    location: { url: '', lineNumber: 1, columnNumber: 1 },
    time,
    pageId,
  }) as any

  it('folds repeats within a second and keeps time order with runner stdio', () => {
    const entries = consoleEntries({
      events: [log('again', 10), log('again', 20), log('again', 1500)],
      stdio: [{ type: 'stdout', timestamp: 5, text: `${ESC}[32mready${ESC}[39m\n` }],
      pageTitle: () => 'page#1',
    })
    expect(entries.map(e => [e.kind, e.text, e.repeat, e.source])).toEqual([
      ['stdout', `${ESC}[32mready${ESC}[39m`, 1, 'test'],
      ['console', 'again', 2, 'page#1'],
      ['console', 'again', 1, 'page#1'],
    ])
  })

  it('turns page errors into error entries with their stack', () => {
    const [entry] = consoleEntries({
      events: [{ type: 'event', method: 'pageError', time: 3, pageId: 'page@1', params: { error: { error: { message: 'boom', stack: 'Error: boom\n    at x' } } } } as any],
      stdio: [],
      pageTitle: () => 'page#1',
    })
    expect(entry).toMatchObject({ kind: 'pageError', level: 'error', label: 'page error', text: 'boom', stack: 'Error: boom\n    at x' })
  })
})
