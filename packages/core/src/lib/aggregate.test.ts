import type { Counts, ProjectEntry, RunSummary } from '../contracts/kinora'
import { describe, expect, it } from 'vitest'
import { collectBranches, collectTags, denom, downsampleTrend, filterRuns, formatDuration, formatPct, incidentMarkers, latestRun, passRate, recentPassRate, runHealth, sortedRuns, trend, trendOf } from './aggregate'

function counts(o: Partial<Counts>): Counts {
  return { total: 0, expected: 0, unexpected: 0, flaky: 0, skipped: 0, ...o }
}

function makeRun(over: Partial<RunSummary> & { runId: string }): RunSummary {
  return {
    projectId: 'p',
    startedAt: '2026-01-01T00:00:00Z',
    duration: 0,
    counts: counts({ total: 10, expected: 10 }),
    countsByTag: {},
    reportPath: 'x',
    ...over,
  }
}

describe('passRate / denom', () => {
  it('counts flaky as pass and excludes skipped from the denominator', () => {
    const c = counts({ total: 10, expected: 7, flaky: 1, unexpected: 1, skipped: 1 })
    expect(denom(c)).toBe(9)
    expect(passRate(c)).toBeCloseTo(8 / 9)
  })

  it('is 1 when nothing executed', () => {
    expect(passRate(counts({ total: 3, skipped: 3 }))).toBe(1)
  })
})

describe('runHealth', () => {
  it('is failing with any unexpected', () => {
    expect(runHealth(counts({ total: 5, expected: 4, unexpected: 1 }))).toBe('failing')
  })
  it('is flaky with flaky but no unexpected', () => {
    expect(runHealth(counts({ total: 5, expected: 4, flaky: 1 }))).toBe('flaky')
  })
  it('is passing when all expected', () => {
    expect(runHealth(counts({ total: 5, expected: 5 }))).toBe('passing')
  })
  it('is empty with no tests', () => {
    expect(runHealth(counts({}))).toBe('empty')
  })
})

describe('filterRuns', () => {
  const runs = [
    makeRun({ runId: 'a', git: { branch: 'main' }, countsByTag: { '@smoke': counts({ total: 2, expected: 2 }) } }),
    makeRun({ runId: 'b', git: { branch: 'develop' }, countsByTag: {} }),
  ]

  it('filters by branch', () => {
    expect(filterRuns(runs, 'main', null).map(r => r.runId)).toEqual(['a'])
  })

  it('swaps counts for the tag subset and drops runs without the tag', () => {
    const tagged = filterRuns(runs, null, '@smoke')
    expect(tagged.map(r => r.runId)).toEqual(['a'])
    expect(tagged[0].counts).toEqual(counts({ total: 2, expected: 2 }))
  })

  it('returns all runs when no filter', () => {
    expect(filterRuns(runs, null, null)).toHaveLength(2)
  })
})

describe('collectBranches / collectTags', () => {
  const project: ProjectEntry = {
    id: 'p',
    name: 'P',
    runs: [
      makeRun({ runId: 'a', git: { branch: 'main' }, countsByTag: { '@smoke': counts({ total: 1 }) } }),
      makeRun({ runId: 'b', git: { branch: 'develop' }, countsByTag: { '@critical': counts({ total: 1 }) } }),
    ],
  }

  it('collects unique sorted branches', () => {
    expect(collectBranches([project])).toEqual(['develop', 'main'])
  })

  it('collects unique sorted tags', () => {
    expect(collectTags([project])).toEqual(['@critical', '@smoke'])
  })
})

describe('sortedRuns / latestRun', () => {
  const p: ProjectEntry = {
    id: 'p',
    name: 'P',
    runs: [
      makeRun({ runId: 'old', startedAt: '2026-01-01T00:00:00Z' }),
      makeRun({ runId: 'new', startedAt: '2026-01-03T00:00:00Z' }),
      makeRun({ runId: 'mid', startedAt: '2026-01-02T00:00:00Z' }),
    ],
  }

  it('sorts runs newest-first', () => {
    expect(sortedRuns(p).map(r => r.runId)).toEqual(['new', 'mid', 'old'])
  })

  it('latestRun is the most recent', () => {
    expect(latestRun(p)?.runId).toBe('new')
  })

  it('latestRun is undefined for a project with no runs', () => {
    expect(latestRun({ id: 'e', name: 'E', runs: [] })).toBeUndefined()
  })
})

describe('recentPassRate', () => {
  it('pools passed/executed across the most recent n runs', () => {
    const runs = [
      makeRun({ runId: 'a', startedAt: '2026-01-01T00:00:00Z', counts: counts({ total: 10, expected: 10 }) }),
      makeRun({ runId: 'b', startedAt: '2026-01-02T00:00:00Z', counts: counts({ total: 10, expected: 5, unexpected: 5 }) }),
      makeRun({ runId: 'c', startedAt: '2026-01-03T00:00:00Z', counts: counts({ total: 10, expected: 8, flaky: 2 }) }),
    ]
    // recent 2 = c (10/10) + b (5/10) = 15/20
    expect(recentPassRate(runs, 2)).toBeCloseTo(15 / 20)
  })

  it('is 1 when nothing executed in the window', () => {
    expect(recentPassRate([makeRun({ runId: 'x', counts: counts({ total: 2, skipped: 2 }) })], 5)).toBe(1)
  })
})

describe('trend', () => {
  it('returns per-run points oldest-first with pass rates', () => {
    const p: ProjectEntry = {
      id: 'p',
      name: 'P',
      runs: [
        makeRun({ runId: 'new', startedAt: '2026-01-02T00:00:00Z', counts: counts({ total: 4, expected: 2, unexpected: 2 }) }),
        makeRun({ runId: 'old', startedAt: '2026-01-01T00:00:00Z', counts: counts({ total: 4, expected: 4 }) }),
      ],
    }
    const pts = trend(p)
    expect(pts.map(t => t.runId)).toEqual(['old', 'new'])
    expect(pts[1].passRate).toBeCloseTo(0.5)
    expect(pts[1].unexpected).toBe(2)
  })

  it('marks the environment incidents, by their index in the trend', () => {
    const incident = { rule: 'host-unreachable' as const, reason: '4 of 4 tests failed.' }
    const p: ProjectEntry = {
      id: 'p',
      name: 'P',
      runs: [
        makeRun({ runId: 'down', startedAt: '2026-01-02T00:00:00Z', counts: counts({ total: 4, unexpected: 4 }), incident }),
        makeRun({ runId: 'ok', startedAt: '2026-01-01T00:00:00Z', counts: counts({ total: 4, expected: 4 }) }),
      ],
    }
    expect(incidentMarkers(trend(p))).toEqual([{ index: 1, label: 'Environment incident, not counted: 4 of 4 tests failed.' }])
  })
})

describe('trendOf', () => {
  it('builds the same points as trend from bare runs', () => {
    const runs = [makeRun({ runId: 'b', startedAt: '2026-01-02T00:00:00Z' }), makeRun({ runId: 'a' })]
    expect(trendOf(runs)).toEqual(trend({ id: 'p', name: 'p', runs }))
  })
})

describe('downsampleTrend', () => {
  const point = (i: number, passRate = 1) => ({ runId: `r${i}`, startedAt: '', passRate, unexpected: 0, flaky: 0, total: 10, duration: 0 })

  it('keeps a trend within the limit as is', () => {
    const points = Array.from({ length: 5 }, (_, i) => point(i))
    expect(downsampleTrend(points, 10)).toBe(points)
  })

  it('caps the trend at the limit, in order', () => {
    const points = Array.from({ length: 500 }, (_, i) => point(i))
    const out = downsampleTrend(points, 50)
    expect(out).toHaveLength(50)
    expect(out.map(p => Number(p.runId.slice(1)))).toEqual([...out.map(p => Number(p.runId.slice(1)))].sort((a, b) => a - b))
  })

  it('never labels a bucket worst run with another run incident', () => {
    const points = Array.from({ length: 500 }, (_, i) => ({ ...point(i, i === 237 ? 0.5 : 1), ...(i === 238 && { passRate: 0.9, incident: 'Staging down.' }) }))
    const out = downsampleTrend(points, 50)
    expect(out.find(p => p.runId === 'r237')).not.toHaveProperty('incident')
    expect(out.filter(p => p.incident)).toEqual([])
  })

  it('keeps the worst run of each bucket so a failure stays visible', () => {
    const points = Array.from({ length: 500 }, (_, i) => point(i, i === 237 ? 0.2 : 1))
    expect(downsampleTrend(points, 50).filter(p => p.passRate < 1).map(p => p.runId)).toEqual(['r237'])
  })
})

describe('formatDuration / formatPct', () => {
  it('formats sub-second, seconds, and minutes', () => {
    expect(formatDuration(500)).toBe('500ms')
    expect(formatDuration(1500)).toBe('1.5s')
    expect(formatDuration(90_000)).toBe('1m 30s')
  })

  it('formats a fraction as a percentage', () => {
    expect(formatPct(0.1234)).toBe('12.3%')
  })
})
