import { describe, expect, it } from 'vitest'
import { ariaLineTokens, ariaSnapshotLines } from '../src/ui/lib/aria'

describe('ariaSnapshotLines', () => {
  it('renders a JSON snapshot as YAML and moves boxes to their lines', () => {
    const json = JSON.stringify([{
      role: 'main',
      box: { x: 8, y: 8, width: 100, height: 40 },
      children: [
        { role: 'heading', name: 'Checkout', level: 1, box: { x: 8, y: 8, width: 100, height: 20 } },
        'Customer email',
        { role: 'button', name: 'Complete checkout', disabled: true },
      ],
    }])
    expect(ariaSnapshotLines(json)).toEqual([
      { box: { x: 8, y: 8, width: 100, height: 40 }, text: '- main:' },
      { box: { x: 8, y: 8, width: 100, height: 20 }, text: '  - heading "Checkout" [level=1]' },
      { box: undefined, text: '  - text: Customer email' },
      { box: undefined, text: '  - button "Complete checkout" [disabled]' },
    ])
  })

  it('offsets boxes inside iframes by the iframe position', () => {
    const json = JSON.stringify([{
      role: 'iframe',
      box: { x: 100, y: 50, width: 300, height: 200 },
      children: [{ role: 'button', name: 'Pay', box: { x: 10, y: 20, width: 40, height: 16 } }],
    }])
    expect(ariaSnapshotLines(json)[1]).toEqual({ box: { x: 110, y: 70, width: 40, height: 16 }, text: '  - button "Pay"' })
  })

  it('keeps non-JSON snapshots as recorded', () => {
    expect(ariaSnapshotLines('- main:\n  - button "Pay"\n')).toEqual([{ text: '- main:' }, { text: '  - button "Pay"' }])
    expect(ariaSnapshotLines('{"role":"main"}')).toEqual([{ text: '{"role":"main"}' }])
  })
})

describe('ariaLineTokens', () => {
  it('splits role, strings and attributes', () => {
    expect(ariaLineTokens('  - heading "Checkout" [level=1]')).toEqual([
      { text: '  - ' },
      { kind: 'role', text: 'heading' },
      { text: ' ' },
      { kind: 'string', text: '"Checkout"' },
      { text: ' ' },
      { kind: 'attribute', text: '[level=1]' },
    ])
  })

  it('treats regexes as strings and leaves plain text untouched', () => {
    expect(ariaLineTokens('- link /Order \\d+/')).toEqual([
      { text: '- ' },
      { kind: 'role', text: 'link' },
      { text: ' ' },
      { kind: 'string', text: '/Order \\d+/' },
    ])
    expect(ariaLineTokens('  - text: Customer email')).toEqual([
      { text: '  - ' },
      { kind: 'role', text: 'text' },
      { text: ': Customer email' },
    ])
  })
})
