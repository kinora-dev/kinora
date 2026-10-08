import type { RunReport, TestHistory, TestPoint } from '../contracts/kinora'
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

// A test is interesting if it has ever failed or flaked.
export function isUnstable(h: TestHistory): boolean {
  return h.failed > 0 || h.flaky > 0
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
      h.points.push({
        runId: report.runId,
        startedAt: report.startedAt,
        status: t.status,
        duration: t.duration,
        retries: t.retries,
        errorMessage: t.errors[0]?.message,
      })
    }
  }

  for (const h of byKey.values()) {
    for (const p of h.points) {
      h.runs++
      if (p.status === 'expected')
        h.passed++
      else if (p.status === 'unexpected')
        h.failed++
      else if (p.status === 'flaky')
        h.flaky++
      else h.skipped++
    }
    h.executed = h.runs - h.skipped
    const d = Math.max(1, h.executed)
    h.flakyRate = h.flaky / d
    h.failRate = h.failed / d
    h.passRate = h.executed === 0 ? 1 : (h.passed + h.flaky) / d
    h.lastStatus = h.points.at(-1)?.status ?? h.lastStatus

    // Windowed view: rates over the last N runs, and whether instability is new.
    const recent = h.points.slice(-RECENT_WINDOW)
    const prior = h.points.slice(0, -RECENT_WINDOW)
    const recentExecuted = recent.filter(p => p.status !== 'skipped').length
    const recentFlaky = recent.filter(p => p.status === 'flaky').length
    const recentFailed = recent.filter(p => p.status === 'unexpected').length
    const rd = Math.max(1, recentExecuted)
    h.recentFlakyRate = recentFlaky / rd
    h.recentFailRate = recentFailed / rd
    h.newlyFlaky = prior.length > 0 && !prior.some(p => p.status === 'flaky') && recentFlaky > 0
    h.newlyBroken = prior.length > 0 && !prior.some(p => p.status === 'unexpected') && recentFailed > 0
  }

  return [...byKey.values()]
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
