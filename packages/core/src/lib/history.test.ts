import type { NormTest, RunReport } from '../contracts/kinora'
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '../contracts/kinora'
import { buildTestHistories, byInstability, byRecency, isUnstable, windowStats } from './history'

function makeTest(over: Partial<NormTest> & { testKey: string, status: NormTest['status'] }): NormTest {
  return {
    title: 't',
    titlePath: ['t'],
    file: 'f.ts',
    line: 1,
    column: 1,
    projectName: 'chromium',
    ok: true,
    duration: 100,
    retries: 0,
    tags: [],
    annotations: [],
    errors: [],
    attachments: [],
    ...over,
  }
}

function makeReport(runId: string, startedAt: string, tests: NormTest[]): RunReport {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId,
    projectId: 'p',
    startedAt,
    duration: 0,
    counts: { total: tests.length, expected: 0, unexpected: 0, flaky: 0, skipped: 0 },
    meta: {},
    tests,
  }
}

describe('buildTestHistories', () => {
  it('orders points chronologically regardless of input order', () => {
    const r2 = makeReport('r2', '2026-01-02T00:00:00Z', [makeTest({ testKey: 'K', status: 'unexpected' })])
    const r1 = makeReport('r1', '2026-01-01T00:00:00Z', [makeTest({ testKey: 'K', status: 'expected' })])
    const [h] = buildTestHistories([r2, r1])
    expect(h.points.map(p => p.runId)).toEqual(['r1', 'r2'])
    expect(h.lastStatus).toBe('unexpected')
  })

  it('computes rates with skipped excluded from the denominator', () => {
    const runs = [
      makeReport('r1', '2026-01-01T00:00:00Z', [makeTest({ testKey: 'K', status: 'expected' })]),
      makeReport('r2', '2026-01-02T00:00:00Z', [makeTest({ testKey: 'K', status: 'flaky' })]),
      makeReport('r3', '2026-01-03T00:00:00Z', [makeTest({ testKey: 'K', status: 'unexpected' })]),
      makeReport('r4', '2026-01-04T00:00:00Z', [makeTest({ testKey: 'K', status: 'skipped' })]),
    ]
    const [h] = buildTestHistories(runs)
    expect(h.runs).toBe(4)
    expect(h.executed).toBe(3)
    expect(h.passed).toBe(1)
    expect(h.flaky).toBe(1)
    expect(h.failed).toBe(1)
    expect(h.flakyRate).toBeCloseTo(1 / 3)
    expect(h.failRate).toBeCloseTo(1 / 3)
    expect(h.passRate).toBeCloseTo(2 / 3) // flaky counts as pass
  })

  it('only records points for runs where the test is present', () => {
    const runs = [
      makeReport('r1', '2026-01-01T00:00:00Z', [
        makeTest({ testKey: 'A', status: 'expected' }),
        makeTest({ testKey: 'B', status: 'expected' }),
      ]),
      makeReport('r2', '2026-01-02T00:00:00Z', [makeTest({ testKey: 'A', status: 'expected' })]),
    ]
    const b = buildTestHistories(runs).find(h => h.testKey === 'B')
    expect(b?.runs).toBe(1)
  })

  it('flags unstable on fail or flaky only', () => {
    const [stable] = buildTestHistories([makeReport('r1', '2026-01-01T00:00:00Z', [makeTest({ testKey: 'K', status: 'expected' })])])
    const [flaky] = buildTestHistories([makeReport('r1', '2026-01-01T00:00:00Z', [makeTest({ testKey: 'K', status: 'flaky' })])])
    expect(isUnstable(stable)).toBe(false)
    expect(isUnstable(flaky)).toBe(true)
  })

  it('ranks failures above flakiness', () => {
    const failing = buildTestHistories([makeReport('r1', '2026-01-01T00:00:00Z', [makeTest({ testKey: 'F', status: 'unexpected' })])])[0]
    const flaky = buildTestHistories([makeReport('r1', '2026-01-01T00:00:00Z', [makeTest({ testKey: 'L', status: 'flaky' })])])[0]
    expect([flaky, failing].sort(byInstability)[0].testKey).toBe('F')
  })
})

describe('windowed flakiness', () => {
  function histFromStatuses(statuses: NormTest['status'][]): ReturnType<typeof buildTestHistories>[number] {
    const runs = statuses.map((status, i) =>
      makeReport(`r${i}`, `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`, [makeTest({ testKey: 'K', status })]),
    )
    return buildTestHistories(runs)[0]
  }

  it('flags newlyFlaky when flakiness only appears in the recent window', () => {
    const h = histFromStatuses(['expected', 'expected', 'expected', 'expected', 'expected', 'flaky', 'expected', 'expected'])
    expect(h.newlyFlaky).toBe(true)
    expect(h.newlyBroken).toBe(false)
    expect(h.recentFlakyRate).toBeCloseTo(1 / 5)
  })

  it('does not flag newlyFlaky when it was already flaky before the window', () => {
    const h = histFromStatuses(['flaky', 'expected', 'expected', 'expected', 'expected', 'flaky', 'expected', 'expected'])
    expect(h.newlyFlaky).toBe(false)
  })

  it('flags newlyBroken on a recent first failure', () => {
    const h = histFromStatuses(['expected', 'expected', 'expected', 'expected', 'expected', 'expected', 'expected', 'unexpected'])
    expect(h.newlyBroken).toBe(true)
  })

  it('byRecency surfaces newly-broken first', () => {
    const newlyBroken = histFromStatuses(['expected', 'expected', 'expected', 'expected', 'expected', 'unexpected'])
    const oldFlaky = histFromStatuses(['flaky', 'flaky', 'flaky', 'flaky', 'flaky', 'flaky'])
    expect([oldFlaky, newlyBroken].sort(byRecency)[0]).toBe(newlyBroken)
  })
})

describe('buildTestHistories stories', () => {
  it('exposes the stories mounted in the latest run', () => {
    const story = (id: string) => ({ type: 'kinora:story', description: id })
    const r1 = makeReport('r1', '2026-01-01T00:00:00Z', [
      makeTest({ testKey: 'K', status: 'expected', annotations: [story('Button/Old')] }),
      makeTest({ testKey: 'E2E', status: 'expected' }),
    ])
    const r2 = makeReport('r2', '2026-01-02T00:00:00Z', [
      makeTest({ testKey: 'K', status: 'expected', annotations: [story('Button/Primary'), story('Button/Primary')] }),
    ])
    const byKey = new Map(buildTestHistories([r2, r1]).map(h => [h.testKey, h]))
    expect(byKey.get('K')?.stories).toEqual(['Button/Primary'])
    expect(byKey.get('E2E')?.stories).toBeUndefined()
  })
})

describe('windowStats', () => {
  const points = (...statuses: NormTest['status'][]) => statuses.map(status => ({ status }))

  it('computes rates over executed points, ignoring skipped', () => {
    expect(windowStats(points('expected', 'unexpected', 'flaky', 'skipped', 'expected'))).toEqual({ failRate: 0.25, flakyRate: 0.25, unstable: true })
  })

  it('only reads the last `window` points', () => {
    expect(windowStats(points('unexpected', 'flaky', 'expected', 'expected'), 2)).toEqual({ failRate: 0, flakyRate: 0, unstable: false })
  })

  it('is stable when nothing ran', () => {
    expect(windowStats(points('skipped'))).toEqual({ failRate: 0, flakyRate: 0, unstable: false })
    expect(windowStats([])).toEqual({ failRate: 0, flakyRate: 0, unstable: false })
  })
})
