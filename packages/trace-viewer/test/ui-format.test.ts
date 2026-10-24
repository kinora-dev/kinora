import { describe, expect, it } from 'vitest'
import { formatMs } from '../src/ui/lib/format'

describe('formatMs', () => {
  it('is empty for undefined or non-finite', () => {
    expect(formatMs(undefined)).toBe('')
    expect(formatMs(Number.NaN)).toBe('')
    expect(formatMs(Number.POSITIVE_INFINITY)).toBe('')
  })

  it('formats sub-second as ms', () => {
    expect(formatMs(0)).toBe('0ms')
    expect(formatMs(949)).toBe('949ms')
  })

  it('formats seconds with one decimal', () => {
    expect(formatMs(1500)).toBe('1.5s')
  })

  it('formats minutes as MmSSs with zero-padded seconds', () => {
    expect(formatMs(90_000)).toBe('1m30s')
    expect(formatMs(125_000)).toBe('2m05s')
  })

  it('rounds into the next unit instead of overflowing it', () => {
    expect(formatMs(999.6)).toBe('1.0s')
    expect(formatMs(59_960)).toBe('1m00s')
    expect(formatMs(119_700)).toBe('2m00s')
  })
})
