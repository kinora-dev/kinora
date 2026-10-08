import { describe, expect, it } from 'vitest'
import { formatBytes, formatDateTime, formatDateTimeLong, money } from './format'

describe('formatBytes', () => {
  it('scales to the largest fitting unit', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(250 * 1024 ** 3)).toBe('250 GB')
  })
})

describe('money', () => {
  it('formats cents, keeping sub-cent unit prices', () => {
    expect(money(14900, 'usd')).toBe('$149.00')
    expect(money(0.4, 'usd')).toBe('$0.004')
  })
})

describe('formatDateTime', () => {
  // Output is locale- and timezone-dependent, so compare against Intl rather than a literal.
  const iso = '2026-10-07T15:51:00Z'
  const parts = (weekday?: 'short') => new Intl.DateTimeFormat(undefined, { weekday, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

  it('formats an ISO string or a Date without the weekday', () => {
    expect(formatDateTime(iso)).toBe(parts())
    expect(formatDateTime(new Date(iso))).toBe(parts())
  })

  it('adds the weekday in the long form', () => {
    expect(formatDateTimeLong(iso)).toBe(parts('short'))
    expect(formatDateTimeLong(iso)).not.toBe(formatDateTime(iso))
  })
})
