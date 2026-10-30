import type { Counts, ProjectEntry, RunSummary } from '../contracts/kinora'

export type RunHealth = 'passing' | 'flaky' | 'failing' | 'empty'

// Skipped tests don't count against the denominator.
export function denom(c: Counts): number {
  return Math.max(0, c.total - c.skipped)
}

// Flaky tests passed eventually, so they count as passing.
export function passRate(c: Counts): number {
  const d = denom(c)
  return d === 0 ? 1 : (c.expected + c.flaky) / d
}

export function runHealth(c: Counts): RunHealth {
  if (c.total === 0)
    return 'empty'
  if (c.unexpected > 0)
    return 'failing'
  if (c.flaky > 0)
    return 'flaky'
  return 'passing'
}

// A grouped run still missing shards holds part of the suite only, so its counts must never read
// as the run's health. Returns what to show instead (undefined for a complete run).
export function partialRunLabel(r: Pick<RunSummary, 'status' | 'shardProgress'>): string | undefined {
  if (!r.status || r.status === 'complete')
    return undefined
  const shards = r.shardProgress ? `${r.shardProgress.landed} of ${r.shardProgress.total} shards` : 'shards missing'
  return r.status === 'incomplete' ? `Incomplete · ${shards}` : shards
}

export function sortedRuns(p: ProjectEntry): RunSummary[] {
  return [...p.runs].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
}

export function latestRun(p: ProjectEntry): RunSummary | undefined {
  return sortedRuns(p)[0]
}

// Pooled pass rate over the most recent n runs (sums passed/executed across them, not an average of per-run rates).
export function recentPassRate(runs: RunSummary[], n: number): number {
  const recent = [...runs].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).slice(0, n)
  let pass = 0
  let total = 0
  for (const r of recent) {
    pass += r.counts.expected + r.counts.flaky
    total += denom(r.counts)
  }
  return total === 0 ? 1 : pass / total
}

export interface TrendPoint {
  runId: string
  startedAt: string
  passRate: number
  unexpected: number
  flaky: number
  total: number
  duration: number
  // Why the run is an environment incident, when it is one: explains a dip in the trend.
  incident?: string
}

export function trend(p: ProjectEntry): TrendPoint[] {
  return [...p.runs]
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    .map(r => ({
      runId: r.runId,
      startedAt: r.startedAt,
      passRate: passRate(r.counts),
      unexpected: r.counts.unexpected,
      flaky: r.counts.flaky,
      total: r.counts.total,
      duration: r.duration,
      ...(r.incident && { incident: r.incident.reason }),
    }))
}

// The points of a trend to call out on its chart, by index: the environment incidents.
export function incidentMarkers(points: TrendPoint[]): { index: number, label: string }[] {
  return points.flatMap((p, index) => p.incident ? [{ index, label: `Environment incident, not counted: ${p.incident}` }] : [])
}

export function collectBranches(projects: ProjectEntry[]): string[] {
  const s = new Set<string>()
  for (const p of projects) {
    for (const r of p.runs) {
      if (r.git?.branch)
        s.add(r.git.branch)
    }
  }
  return [...s].sort()
}

export function collectTags(projects: ProjectEntry[]): string[] {
  const s = new Set<string>()
  for (const p of projects) {
    for (const r of p.runs) {
      for (const t of Object.keys(r.countsByTag)) s.add(t)
    }
  }
  return [...s].sort()
}

// Branch filters runs out; tag swaps each run's counts for that tag's subset
// (dropping runs that have no tests with the tag).
export function filterRuns(
  runs: RunSummary[],
  branch: string | null,
  tag: string | null,
): RunSummary[] {
  let out = runs
  if (branch)
    out = out.filter(r => r.git?.branch === branch)
  if (tag) {
    out = out.flatMap((r) => {
      const c = r.countsByTag[tag]
      return c ? [{ ...r, counts: c }] : []
    })
  }
  return out
}

export function formatDuration(ms: number): string {
  if (ms < 1000)
    return `${ms}ms`
  const s = ms / 1000
  if (s < 60)
    return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

export function formatPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}
