import { describe, expect, it } from 'vitest'
import { ariaLineTokens, ariaSnapshotText } from '../src/ui/lib/aria'

describe('ariaSnapshotText', () => {
  it('renders a JSON snapshot as YAML without boxes', () => {
    const json = JSON.stringify([{
      role: 'main',
      box: { x: 8, y: 8, width: 100, height: 40 },
      children: [
        { role: 'heading', name: 'Checkout', level: 1, box: { x: 8, y: 8, width: 100, height: 20 } },
        'Customer email',
        { role: 'button', name: 'Complete checkout', disabled: true },
      ],
    }])
    expect(ariaSnapshotText(json)).toBe([
      '- main:',
      '  - heading "Checkout" [level=1]',
      '  - text: Customer email',
      '  - button "Complete checkout" [disabled]',
    ].join('\n'))
  })

  it('keeps non-JSON snapshots as recorded', () => {
    expect(ariaSnapshotText('- button "Pay"')).toBe('- button "Pay"')
    expect(ariaSnapshotText('{"role":"main"}')).toBe('{"role":"main"}')
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
