import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatShardPlan, loadDurations, parseGranularity, parseShardTotal, writeShardPlan } from '../src/shard'

function spec(title: string, duration?: number) {
  return { title, ok: true, tags: [], file: '', line: 1, column: 1, tests: [{ status: duration === undefined ? 'skipped' : 'expected', projectName: 'chromium', results: duration === undefined ? [] : [{ status: 'passed', duration }] }] }
}

function report(files: Record<string, [string, number?][]>) {
  return {
    config: {},
    stats: { startTime: '2026-01-01T00:00:00.000Z', duration: 0, expected: 0, unexpected: 0, flaky: 0, skipped: 0 },
    suites: Object.entries(files).map(([file, specs]) => ({ title: file, file, specs: specs.map(([title, d]) => ({ ...spec(title, d), file })) })),
  }
}

const LIST = report({ 'slow.spec.ts': [['one'], ['two']], 'fast.spec.ts': [['three']], 'mid.spec.ts': [['four']] })

describe('writeShardPlan', () => {
  it('writes one test list per shard, balanced on the durations of a previous report', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kinora-shard-'))
    try {
      const durations = await loadDurations({ kind: 'report', report: report({ 'slow.spec.ts': [['one', 4000], ['two', 4000]], 'fast.spec.ts': [['three', 500]], 'mid.spec.ts': [['four', 3000]] }) })
      const plan = await writeShardPlan({ list: LIST, total: 2, outDir: dir, granularity: 'file', durations })

      expect(await readFile(join(dir, 'shard-1.txt'), 'utf8')).toBe('# kinora shard 1/2: 2 tests, ~8s estimated\n[chromium] › slow.spec.ts\n')
      expect(await readFile(join(dir, 'shard-2.txt'), 'utf8')).toBe('# kinora shard 2/2: 2 tests, ~4s estimated\n[chromium] › fast.spec.ts\n[chromium] › mid.spec.ts\n')
      expect(formatShardPlan(plan)).toContain('4 tests with a known duration, 0 estimated')
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects an empty test list', async () => {
    await expect(writeShardPlan({ list: report({}), total: 2, outDir: tmpdir(), granularity: 'file', durations: new Map() })).rejects.toThrow('empty')
  })
})

describe('loadDurations from kinora', () => {
  it('reads the project durations through the read API', async () => {
    let requested = ''
    const fetch = (async (url: string | URL | Request) => {
      requested = String(url)
      return Response.json({ runs: 2, tests: [{ testKey: 'k', duration: 1200, samples: 2 }] })
    }) as typeof globalThis.fetch
    const durations = await loadDurations({ kind: 'kinora', project: 'web app', url: 'https://api.example.com/', token: 't', runs: 10, fetch })

    expect(requested).toBe('https://api.example.com/api/v1/projects/web%20app/test-durations?runs=10')
    expect(durations.get('k')).toBe(1200)
  })
})

describe('shard flags', () => {
  it('validates --total and --granularity', () => {
    expect(parseShardTotal('4')).toBe(4)
    expect(() => parseShardTotal('0')).toThrow()
    expect(() => parseShardTotal(undefined)).toThrow()
    expect(parseGranularity(undefined)).toBe('file')
    expect(parseGranularity('test')).toBe('test')
    expect(() => parseGranularity('spec')).toThrow('file, test')
  })
})
