import type { ShardGranularity, ShardPlan } from '@kinora/core'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createReadClient, planShards, playwrightReportTests, testListFile } from '@kinora/core'

export type DurationSource
  = | { kind: 'kinora', project: string, url: string, token: string, runs?: number, fetch?: typeof globalThis.fetch }
    | { kind: 'report', report: unknown }

export interface ShardCommandOptions {
  list: unknown
  total: number
  outDir: string
  granularity: ShardGranularity
  durations: Map<string, number>
}

export function parseGranularity(raw: string | undefined): ShardGranularity {
  if (raw === undefined || raw === 'file' || raw === 'test')
    return raw ?? 'file'
  throw new Error(`unknown --granularity value: ${raw} (allowed: file, test)`)
}

export function parseShardTotal(raw: string | undefined): number {
  const n = Number(raw)
  if (!raw || !Number.isInteger(n) || n < 1)
    throw new Error('--total <n> must be a positive integer')
  return n
}

export async function loadDurations(source: DurationSource): Promise<Map<string, number>> {
  if (source.kind === 'report') {
    return new Map(playwrightReportTests(source.report)
      .filter(t => t.status !== 'skipped')
      .map(t => [t.testKey, t.duration]))
  }
  const client = createReadClient({ baseUrl: source.url, token: source.token, fetch: source.fetch })
  const { tests } = await client.getTestDurations(source.project, source.runs)
  return new Map(tests.map(t => [t.testKey, t.duration]))
}

// Writes shard-1.txt ... shard-N.txt, the `--test-list` file of each shard.
export async function writeShardPlan(opts: ShardCommandOptions): Promise<ShardPlan & { files: string[] }> {
  const tests = playwrightReportTests(opts.list)
  if (!tests.length)
    throw new Error('the test list is empty: pass the output of `playwright test --list --reporter=json`')
  const plan = planShards(tests, { total: opts.total, durations: opts.durations, granularity: opts.granularity })
  await mkdir(opts.outDir, { recursive: true })
  const files = await Promise.all(plan.shards.map(async (shard, i) => {
    const file = join(opts.outDir, `shard-${i + 1}.txt`)
    await writeFile(file, testListFile(shard, i + 1, opts.total))
    return file
  }))
  return { ...plan, files }
}

export function formatShardPlan(plan: ShardPlan & { files: string[] }): string {
  const lines = plan.shards.map((s, i) => `  ${plan.files[i]}  ${String(s.tests).padStart(5)} tests  ~${Math.round(s.duration / 1000)}s`)
  const coverage = `${plan.known} tests with a known duration, ${plan.unknown} estimated at ${Math.round(plan.defaultDuration)}ms`
  return [...lines, coverage].join('\n')
}
