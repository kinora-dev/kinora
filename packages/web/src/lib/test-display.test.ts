import { describe, expect, it } from 'vitest'
import { bySeverity, testLabel } from './test-display'

describe('testLabel', () => {
  it('drops the leading file and joins the suite path', () => {
    expect(testLabel({ titlePath: ['a/b.spec.ts', 'Group', 'does a thing'], title: 'does a thing' }))
      .toBe('Group › does a thing')
  })

  it('handles a file + title with no suite', () => {
    expect(testLabel({ titlePath: ['a/b.spec.ts', 'does a thing'], title: 'does a thing' }))
      .toBe('does a thing')
  })

  it('falls back to the title when there is no suite hierarchy', () => {
    expect(testLabel({ titlePath: ['a/b.spec.ts'], title: 'does a thing' })).toBe('does a thing')
  })
})

describe('bySeverity', () => {
  it('lists failed, flaky, skipped then passed, keeping the order within a status', () => {
    const tests = [
      { id: 'pass-1', status: 'expected' as const },
      { id: 'skip', status: 'skipped' as const },
      { id: 'fail-1', status: 'unexpected' as const },
      { id: 'pass-2', status: 'expected' as const },
      { id: 'flaky', status: 'flaky' as const },
      { id: 'fail-2', status: 'unexpected' as const },
    ]
    expect(bySeverity(tests).map(t => t.id)).toEqual(['fail-1', 'fail-2', 'flaky', 'skip', 'pass-1', 'pass-2'])
  })
})
