import type { NormTest, RunReport } from '../contracts/kinora'
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '../contracts/kinora'
import { diagnose } from './health'
import { applyTotals, buildTestHistories, byInstability, byRecency, countStatuses, durationStats, isSlower, isUnstable, trimPoints, windowStats } from './history'

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

  it('stamps each point with the commit of its run, when the run has one', () => {
    const r1 = { ...makeReport('r1', '2026-01-01T00:00:00Z', [makeTest({ testKey: 'K', status: 'expected' })]), meta: { git: { sha: 'abc' } } }
    const r2 = makeReport('r2', '2026-01-02T00:00:00Z', [makeTest({ testKey: 'K', status: 'expected' })])
    const [h] = buildTestHistories([r1, r2])
    expect(h.points.map(p => p.sha)).toEqual(['abc', undefined])
  })

  it('keeps the a11y check of the latest run that executed', () => {
    const report = { status: 'warning' as const, violations: [] }
    const [kept] = buildTestHistories([
      makeReport('r1', '2026-01-01T00:00:00Z', [makeTest({ testKey: 'K', status: 'expected', a11y: report })]),
      makeReport('r2', '2026-01-02T00:00:00Z', [makeTest({ testKey: 'K', status: 'skipped' })]),
    ])
    expect(kept.a11y).toEqual(report)
    const [dropped] = buildTestHistories([
      makeReport('r1', '2026-01-01T00:00:00Z', [makeTest({ testKey: 'K', status: 'expected', a11y: report })]),
      makeReport('r2', '2026-01-02T00:00:00Z', [makeTest({ testKey: 'K', status: 'expected' })]),
    ])
    expect(dropped.a11y).toBeUndefined()
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
    expect(windowStats(points('expected', 'unexpected', 'flaky', 'skipped', 'expected'))).toEqual({ executed: 4, passRate: 0.75, failRate: 0.25, flakyRate: 0.25, unstable: true })
  })

  it('only reads the last `window` points', () => {
    expect(windowStats(points('unexpected', 'flaky', 'expected', 'expected'), 2)).toEqual({ executed: 2, passRate: 1, failRate: 0, flakyRate: 0, unstable: false })
  })

  it('is stable when nothing ran', () => {
    const idle = { executed: 0, passRate: 1, failRate: 0, flakyRate: 0, unstable: false }
    expect(windowStats(points('skipped'))).toEqual(idle)
    expect(windowStats([])).toEqual(idle)
  })
})

describe('durationStats', () => {
  const point = (status: NormTest['status'], duration: number) => ({ status, duration })

  it('reads only the passing results, whose time is not inflated by retries or timeouts', () => {
    const points = [point('expected', 1000), point('unexpected', 30_000), point('flaky', 9000), point('expected', 3000), point('skipped', 0)]
    expect(durationStats(points)).toEqual({ samples: 2, median: 2000, p90: 2800 })
  })

  it('interpolates percentiles between ranks, as Postgres does', () => {
    const points = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].map(d => point('expected', d))
    expect(durationStats(points)).toEqual({ samples: 10, median: 550, p90: 910 })
  })

  it('only reads the last `window` points', () => {
    expect(durationStats([point('expected', 9000), point('expected', 100), point('expected', 300)], 2)).toEqual({ samples: 2, median: 200, p90: 280 })
  })

  it('has nothing to say without a passing result', () => {
    expect(durationStats([point('unexpected', 5000), point('skipped', 0)])).toBeUndefined()
    expect(durationStats([])).toBeUndefined()
  })
})

describe('isSlower', () => {
  it('needs both a relative and an absolute slowdown', () => {
    expect(isSlower(2000, 1000)).toBe(true)
    // +30% but only 30ms: noise on a fast test.
    expect(isSlower(130, 100)).toBe(false)
    // +1s but only +1% on a long test.
    expect(isSlower(101_000, 100_000)).toBe(false)
  })

  it('says nothing without a median on both sides, or when the test got faster', () => {
    expect(isSlower(2000, null)).toBe(false)
    expect(isSlower(undefined, 1000)).toBe(false)
    expect(isSlower(1000, 2000)).toBe(false)
  })
})

describe('buildTestHistories screenshots', () => {
  it('counts the failed screenshot assertions of each run', () => {
    const png = (name: string) => ({ name, contentType: 'image/png', hasBody: true })
    const r1 = makeReport('r1', '2026-01-01T00:00:00Z', [makeTest({ testKey: 'K', status: 'expected' })])
    const r2 = makeReport('r2', '2026-01-02T00:00:00Z', [makeTest({
      testKey: 'K',
      status: 'unexpected',
      attachments: [png('a-expected.png'), png('a-actual.png'), png('a-diff.png'), png('b-actual.png'), png('screenshot.png')],
    })])
    const [h] = buildTestHistories([r1, r2])
    expect(h.points[0]).not.toHaveProperty('screenshots')
    expect(h.points[1].screenshots).toBe(2)
  })
})

describe('trimPoints', () => {
  const STATUSES: NormTest['status'][] = ['expected', 'unexpected', 'flaky', 'skipped']
  // Deterministic pseudo-random timelines, biased so long failing streaks and skipped stretches occur.
  function timeline(seed: number, length: number) {
    let x = seed
    const next = () => (x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    let status: NormTest['status'] = 'expected'
    return Array.from({ length }, (_, i) => {
      if (next() < 0.3)
        status = STATUSES[Math.floor(next() * STATUSES.length)]
      return { runId: `r${i}`, startedAt: new Date(Date.UTC(2026, 0, 1, i)).toISOString(), status, sha: `c${Math.floor(i / 3)}` }
    })
  }

  it('keeps everything diagnose, windowStats and the recent window read', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const points = timeline(seed, 1 + (seed % 120))
      const trimmed = trimPoints(points)
      expect(diagnose(trimmed)).toEqual(diagnose(points))
      expect(windowStats(trimmed)).toEqual(windowStats(points))
      expect(trimmed.slice(-5)).toEqual(points.slice(-5))
    }
  })

  it('drops settled history and old skipped runs', () => {
    const points = [
      ...Array.from({ length: 200 }, () => ({ status: 'skipped' as const })),
      ...Array.from({ length: 200 }, () => ({ status: 'expected' as const })),
    ]
    expect(trimPoints(points)).toHaveLength(20)
  })

  it('keeps a whole failing streak, however long', () => {
    const points = [{ status: 'expected' as const }, ...Array.from({ length: 300 }, () => ({ status: 'unexpected' as const }))]
    expect(trimPoints(points)).toEqual(points.slice(1))
  })
})

describe('applyTotals', () => {
  it('matches the full history when the points were trimmed', () => {
    const statuses: NormTest['status'][] = ['flaky', 'expected', 'unexpected', ...Array.from({ length: 40 }, () => 'expected' as const), 'flaky', 'expected']
    const reports = statuses.map((status, i) => makeReport(`r${i}`, new Date(Date.UTC(2026, 0, 1, i)).toISOString(), [makeTest({ testKey: 'K', status })]))
    const [full] = buildTestHistories(reports)
    const [trimmed] = buildTestHistories(reports.slice(-20))
    applyTotals(trimmed, countStatuses(full.points))
    expect({ ...trimmed, points: [] }).toEqual({ ...full, points: [] })
  })
})
