import type { NormTest, TestHistory } from '@kinora/core'
import { describe, expect, it } from 'vitest'
import { formatFailure, formatHistory, traceUrlOf } from '../src/format'

function normTest(over: Partial<NormTest> = {}): NormTest {
  return {
    testKey: 'k1',
    title: 'completes a purchase',
    titlePath: ['checkout.spec.ts', 'completes a purchase'],
    file: 'tests/checkout.spec.ts',
    line: 12,
    column: 3,
    projectName: 'chromium',
    status: 'unexpected',
    ok: false,
    duration: 100,
    retries: 1,
    tags: [],
    annotations: [],
    errors: [],
    attachments: [],
    ...over,
  }
}

describe('formatFailure', () => {
  it('emits location, first error, and trace url', () => {
    const t = normTest({
      errors: [{ message: 'boom', location: { file: 'a.ts', line: 1, column: 2 } }],
      attachments: [{ name: 'trace', contentType: 'application/zip', hasBody: true, url: 'https://x/trace.zip' }],
    })
    const f = formatFailure(t)
    expect(f.location).toBe('tests/checkout.spec.ts:12:3')
    expect(f.error?.message).toBe('boom')
    expect(f.traceUrl).toBe('https://x/trace.zip')
  })

  it('truncates a huge error message', () => {
    const t = normTest({ errors: [{ message: 'x'.repeat(10_000) }] })
    expect(formatFailure(t).error!.message).toContain('… (truncated)')
    expect(formatFailure(t).error!.message.length).toBeLessThan(5_000)
  })

  it('returns null error and trace when absent', () => {
    const f = formatFailure(normTest())
    expect(f.error).toBeNull()
    expect(f.traceUrl).toBeNull()
  })
})

describe('traceUrlOf', () => {
  it('ignores attachments without a resolved url', () => {
    expect(traceUrlOf(normTest({ attachments: [{ name: 'trace', contentType: 'application/zip', hasBody: true }] }))).toBeNull()
  })
})

function history(over: Partial<TestHistory> = {}): TestHistory {
  return {
    testKey: 'k1',
    title: 't',
    titlePath: [],
    file: 'f.ts',
    projectName: 'chromium',
    points: [],
    runs: 0,
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    executed: 0,
    flakyRate: 0,
    failRate: 0,
    passRate: 0,
    recentFlakyRate: 0,
    recentFailRate: 0,
    newlyFlaky: false,
    newlyBroken: false,
    lastStatus: 'expected',
    ...over,
  }
}

describe('formatHistory', () => {
  it('caps recent points at 20 and keeps the newly-* flags', () => {
    const points = Array.from({ length: 30 }, (_, i) => ({ runId: `r${i}`, startedAt: '2026-07-14T00:00:00.000Z', status: 'expected' as const, duration: 1, retries: 0 }))
    const h = formatHistory(history({ points, newlyBroken: true, failRate: 0.5 }))
    expect(h.recentPoints).toHaveLength(20)
    expect(h.recentPoints[0].runId).toBe('r10')
    expect(h.newlyBroken).toBe(true)
  })
})

describe('formatFailure screenshots', () => {
  const image = (name: string, url?: string, expired?: boolean) => ({ name, contentType: 'image/png', hasBody: true, ...(url && { url }), ...(expired && { expired }) })

  it('groups a failed screenshot assertion into its expected, actual and diff images', () => {
    const t = normTest({ attachments: [
      image('button-primary-expected.png', 'https://x/e.png'),
      image('button-primary-actual.png', 'https://x/a.png'),
      image('button-primary-diff.png', 'https://x/d.png'),
      image('screenshot', 'https://x/s.png'),
    ] })
    expect(formatFailure(t).screenshots).toEqual([{ name: 'button-primary.png', expected: 'https://x/e.png', actual: 'https://x/a.png', diff: 'https://x/d.png' }])
  })

  it('leaves out images with no hosted file', () => {
    const t = normTest({ attachments: [image('login-actual.png'), image('home-actual.png', 'https://x/h.png', true)] })
    expect(formatFailure(t)).not.toHaveProperty('screenshots')
  })
})
