import type { NormTest } from '../contracts/kinora'

export type ShardGranularity = 'file' | 'test'

export type ListedTest = Pick<NormTest, 'testKey' | 'file' | 'titlePath' | 'projectName'>

export interface PlannedShard {
  // Lines of a Playwright `--test-list` file.
  entries: string[]
  tests: number
  // Estimated ms, from known durations plus the default for tests without one.
  duration: number
}

export interface ShardPlan {
  shards: PlannedShard[]
  known: number
  unknown: number
  defaultDuration: number
}

export interface PlanShardsOptions {
  total: number
  durations: ReadonlyMap<string, number>
  granularity?: ShardGranularity
  // Estimate for a test without history; defaults to the median of the known ones.
  defaultDuration?: number
}

const FALLBACK_DURATION = 1000
const SEP = ' › '

interface Unit {
  key: string
  entry: string
  tests: number
  duration: number
}

function median(values: number[]): number | undefined {
  if (!values.length)
    return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

function entryOf(projectName: string, path: string[]): string {
  return projectName ? `[${projectName}]${SEP}${path.join(SEP)}` : path.join(SEP)
}

// Playwright splits a list line on "›" and trims each token, and matches title paths by prefix.
function fileNeedsWholeEntry(tests: ListedTest[]): boolean {
  const titles = tests.map(t => t.titlePath.slice(1))
  if (titles.some(path => path.some(s => s.includes('›') || s !== s.trim() || !s)))
    return true
  const describes = new Set<string>()
  for (const path of titles) {
    for (let i = 1; i < path.length; i++)
      describes.add(path.slice(0, i).join('\0'))
  }
  return titles.some(path => describes.has(path.join('\0')))
}

function unitsOf(tests: ListedTest[], granularity: ShardGranularity, estimate: (t: ListedTest) => number): Unit[] {
  const byFile = new Map<string, ListedTest[]>()
  for (const t of tests) {
    const key = `${t.projectName}\0${t.file}`
    const list = byFile.get(key)
    if (list)
      list.push(t)
    else
      byFile.set(key, [t])
  }
  const units: Unit[] = []
  for (const [key, group] of byFile) {
    const { projectName, file } = group[0]
    if (granularity === 'file' || fileNeedsWholeEntry(group)) {
      units.push({ key, entry: entryOf(projectName, [file]), tests: group.length, duration: group.reduce((s, t) => s + estimate(t), 0) })
      continue
    }
    for (const t of group)
      units.push({ key: t.testKey, entry: entryOf(projectName, t.titlePath), tests: 1, duration: estimate(t) })
  }
  return units
}

// Longest-first onto the least loaded shard. Deterministic for the same inputs, so every shard job
// computing the plan on its own gets the same split, as long as they read the same durations.
export function planShards(tests: ListedTest[], opts: PlanShardsOptions): ShardPlan {
  const { total, durations, granularity = 'file' } = opts
  if (!Number.isInteger(total) || total < 1)
    throw new Error(`shard total must be a positive integer, got ${total}`)

  const known = tests.flatMap(t => durations.get(t.testKey) ?? [])
  const defaultDuration = opts.defaultDuration ?? median(known) ?? FALLBACK_DURATION
  const estimate = (t: ListedTest) => durations.get(t.testKey) ?? defaultDuration

  const units = unitsOf(tests, granularity, estimate)
    .sort((a, b) => b.duration - a.duration || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const shards: PlannedShard[] = Array.from({ length: total }, () => ({ entries: [], tests: 0, duration: 0 }))
  for (const unit of units) {
    let target = shards[0]
    for (const s of shards) {
      if (s.duration < target.duration)
        target = s
    }
    target.entries.push(unit.entry)
    target.tests += unit.tests
    target.duration += unit.duration
  }
  for (const s of shards)
    s.entries.sort()
  return { shards, known: known.length, unknown: tests.length - known.length, defaultDuration }
}

export function testListFile(shard: PlannedShard, index: number, total: number): string {
  const header = `# kinora shard ${index}/${total}: ${shard.tests} tests, ~${Math.round(shard.duration / 1000)}s estimated\n`
  return header + shard.entries.map(e => `${e}\n`).join('')
}
