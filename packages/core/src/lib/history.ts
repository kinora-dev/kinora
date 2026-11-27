import type { RunReport, TestHistory, TestPoint } from '../contracts/kinora'
import { splitScreenshotComparisons } from './attachments'
import { storiesOf } from './story'

export type { TestHistory, TestPoint } from '../contracts/kinora'

// Sliding window for "recent" flaky/fail rates and the newly-flaky/broken signals.
export const RECENT_WINDOW = 5

// Runs the dashboard list views (Tests, Components) read: their timelines, rates and "unstable"
// filter all cover the same last N points, so the numbers match the bars.
export const HEALTH_WINDOW = 20

export interface WindowStats { executed: number, passRate: number, failRate: number, flakyRate: number, unstable: boolean }

// Health of a timeline over its last `window` points. Unstable = failed or flaked at least once.
export function windowStats(points: Pick<TestPoint, 'status'>[], window = HEALTH_WINDOW): WindowStats {
  const pts = points.slice(-window)
  const executed = pts.filter(p => p.status !== 'skipped').length
  const fails = pts.filter(p => p.status === 'unexpected').length
  const flakies = pts.filter(p => p.status === 'flaky').length
  return {
    executed,
    // Flaky runs passed eventually, so they count as passing (same as a run's pass rate).
    passRate: executed ? (executed - fails) / executed : 1,
    failRate: executed ? fails / executed : 0,
    flakyRate: executed ? flakies / executed : 0,
    unstable: fails > 0 || flakies > 0,
  }
}

export interface DurationStats { samples: number, median: number, p90: number }

// How long a test takes, over the passing results among its last `window` points: a failed or
// flaky result sums its retries and waits out timeouts, so it says nothing about the test's speed.
export function durationStats(points: Pick<TestPoint, 'status' | 'duration'>[], window = HEALTH_WINDOW): DurationStats | undefined {
  const sorted = points.slice(-window).filter(p => p.status === 'expected').map(p => p.duration).sort((a, b) => a - b)
  if (!sorted.length)
    return undefined
  return { samples: sorted.length, median: Math.round(percentile(sorted, 0.5)), p90: Math.round(percentile(sorted, 0.9)) }
}

// The newest passing results a test's current speed is read from, compared with the ones before.
export const RECENT_DURATION_SAMPLES = 5

// Both thresholds: a ratio alone flags a 100ms test going to 130ms, a delta alone a 2-minute one
// wobbling by a second.
const SLOWER_RATIO = 1.25
const SLOWER_MS = 500

// Whether a test got slower: its recent median duration against the median before it.
export function isSlower(recentMedian: number | null | undefined, earlierMedian: number | null | undefined): boolean {
  if (recentMedian == null || earlierMedian == null)
    return false
  return recentMedian >= earlierMedian * SLOWER_RATIO && recentMedian - earlierMedian >= SLOWER_MS
}

// Interpolates between the two closest ranks, as Postgres' percentile_cont does.
function percentile(sorted: number[], q: number): number {
  const at = (sorted.length - 1) * q
  const lo = sorted[Math.floor(at)]!
  const hi = sorted[Math.ceil(at)]!
  return lo + (hi - lo) * (at - Math.floor(at))
}

// A test is interesting if it has ever failed or flaked.
export function isUnstable(h: TestHistory): boolean {
  return h.failed > 0 || h.flaky > 0
}

function screenshotCount(attachments: RunReport['tests'][number]['attachments']): { screenshots?: number } {
  const screenshots = splitScreenshotComparisons(attachments).comparisons.length
  return screenshots ? { screenshots } : {}
}

// Build per-test timelines from a project's run reports. Reports may arrive in
// any order; points are sorted chronologically. A test absent from a run simply
// has no point for it.
export function buildTestHistories(reports: RunReport[]): TestHistory[] {
  const byKey = new Map<string, TestHistory>()

  const sorted = [...reports].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))

  for (const report of sorted) {
    for (const t of report.tests) {
      let h = byKey.get(t.testKey)
      if (!h) {
        h = {
          testKey: t.testKey,
          title: t.title,
          titlePath: t.titlePath,
          file: t.file,
          projectName: t.projectName,
          codeOwners: t.codeOwners,
          points: [],
          runs: 0,
          passed: 0,
          failed: 0,
          flaky: 0,
          skipped: 0,
          executed: 0,
          flakyRate: 0,
          failRate: 0,
          passRate: 1,
          recentFlakyRate: 0,
          recentFailRate: 0,
          newlyFlaky: false,
          newlyBroken: false,
          lastStatus: t.status,
        }
        byKey.set(t.testKey, h)
      }
      if (!h.codeOwners?.length && t.codeOwners?.length)
        h.codeOwners = t.codeOwners
      // Latest run that mounted anything wins: a test can be pointed at other stories over time,
      // and a run where it was skipped (or failed before mounting) records none.
      const stories = storiesOf(t)
      if (stories.length)
        h.stories = stories
      // Same for the a11y check, so a story whose check was turned off stops showing old violations.
      if (t.status !== 'skipped') {
        if (t.a11y)
          h.a11y = t.a11y
        else
          delete h.a11y
      }
      h.points.push({
        runId: report.runId,
        startedAt: report.startedAt,
        status: t.status,
        duration: t.duration,
        retries: t.retries,
        errorMessage: t.errors[0]?.message,
        ...(report.meta.git?.sha && { sha: report.meta.git.sha }),
        ...screenshotCount(t.attachments),
      })
    }
  }

  for (const h of byKey.values())
    applyTotals(h, countStatuses(h.points))

  return [...byKey.values()]
}

export interface StatusCounts { passed: number, failed: number, flaky: number, skipped: number }

export function countStatuses(points: Pick<TestPoint, 'status'>[]): StatusCounts {
  const c = { passed: 0, failed: 0, flaky: 0, skipped: 0 }
  for (const p of points) {
    if (p.status === 'expected')
      c.passed++
    else if (p.status === 'unexpected')
      c.failed++
    else if (p.status === 'flaky')
      c.flaky++
    else c.skipped++
  }
  return c
}

// Counts and rates of a history. `totals` may cover more runs than `h.points` holds (a server that
// trimmed the points, see trimPoints); the recent window still reads the newest points.
export function applyTotals(h: TestHistory, totals: StatusCounts): void {
  h.passed = totals.passed
  h.failed = totals.failed
  h.flaky = totals.flaky
  h.skipped = totals.skipped
  h.runs = totals.passed + totals.failed + totals.flaky + totals.skipped
  h.executed = h.runs - h.skipped
  const d = Math.max(1, h.executed)
  h.flakyRate = h.flaky / d
  h.failRate = h.failed / d
  h.passRate = h.executed === 0 ? 1 : (h.passed + h.flaky) / d
  h.lastStatus = h.points.at(-1)?.status ?? h.lastStatus

  // Windowed view: rates over the last N runs, and whether instability is new.
  const recent = countStatuses(h.points.slice(-RECENT_WINDOW))
  const recentRuns = recent.passed + recent.failed + recent.flaky + recent.skipped
  const priorRuns = h.runs - recentRuns
  const rd = Math.max(1, recentRuns - recent.skipped)
  h.recentFlakyRate = recent.flaky / rd
  h.recentFailRate = recent.failed / rd
  h.newlyFlaky = priorRuns > 0 && h.flaky === recent.flaky && recent.flaky > 0
  h.newlyBroken = priorRuns > 0 && h.failed === recent.failed && recent.failed > 0
}

// The points a test's health needs, oldest first: the last `window` runs (timelines, windowStats,
// the recent window), its last `window` executed runs (diagnose), and the whole failing streak it
// is in (diagnose dates a broken test from its first failure). Older points, mostly skipped runs or
// settled history, are dropped: a project's full history is tests x runs points, too big to send.
export function trimPoints<P extends Pick<TestPoint, 'status'>>(points: P[], window = HEALTH_WINDOW): P[] {
  const keep = new Set<number>()
  for (let i = Math.max(0, points.length - window); i < points.length; i++)
    keep.add(i)
  let executed = 0
  let streak = true
  for (let i = points.length - 1; i >= 0; i--) {
    const status = points[i].status
    if (status === 'skipped')
      continue
    streak &&= status === 'unexpected'
    if (executed < window || streak)
      keep.add(i)
    executed++
    if (executed >= window && !streak)
      break
  }
  return points.filter((_, i) => keep.has(i))
}

// Most unstable first: weight failures above flakiness.
export function byInstability(a: TestHistory, b: TestHistory): number {
  const score = (h: TestHistory) => h.failRate * 2 + h.flakyRate
  return score(b) - score(a)
}

// Surface newly-broken, then newly-flaky, then fall back to overall instability.
export function byRecency(a: TestHistory, b: TestHistory): number {
  const rank = (h: TestHistory) => (h.newlyBroken ? 2 : h.newlyFlaky ? 1 : 0)
  return rank(b) - rank(a) || byInstability(a, b)
}
