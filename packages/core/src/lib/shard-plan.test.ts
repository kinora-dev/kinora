import type { ListedTest } from './shard-plan'
import { describe, expect, it } from 'vitest'
import { planShards, testListFile } from './shard-plan'
import { makeTestKey } from './test-key'

function t(file: string, titles: string[], projectName = 'chromium'): ListedTest {
  const titlePath = [file, ...titles]
  return { testKey: makeTestKey(file, titlePath, projectName), file, titlePath, projectName }
}

const durations = (entries: [ListedTest, number][]) => new Map(entries.map(([test, ms]) => [test.testKey, ms]))

describe('planShards', () => {
  it('balances whole files by duration, not by test count', () => {
    const slow = t('slow.spec.ts', ['one'])
    const fast = ['a', 'b', 'c'].map(x => t('fast.spec.ts', [x]))
    const other = t('other.spec.ts', ['x'])
    const plan = planShards([slow, ...fast, other], { total: 2, durations: durations([[slow, 9000], [fast[0], 1000], [fast[1], 1000], [fast[2], 1000], [other, 5000]]) })

    expect(plan.shards.map(s => s.entries)).toEqual([
      ['[chromium] › slow.spec.ts'],
      ['[chromium] › fast.spec.ts', '[chromium] › other.spec.ts'],
    ])
    expect(plan.shards.map(s => s.duration)).toEqual([9000, 8000])
    expect(plan.shards.map(s => s.tests)).toEqual([1, 4])
  })

  it('assigns every test exactly once, deterministically', () => {
    const tests = Array.from({ length: 40 }, (_, i) => t(`f${i % 7}.spec.ts`, [`test ${i}`]))
    const d = new Map(tests.map((x, i) => [x.testKey, (i * 37) % 11 * 100]))
    const a = planShards(tests, { total: 3, durations: d, granularity: 'test' })
    const b = planShards([...tests].reverse(), { total: 3, durations: d, granularity: 'test' })

    expect(a).toEqual(b)
    const entries = a.shards.flatMap(s => s.entries)
    expect(entries).toHaveLength(40)
    expect(new Set(entries).size).toBe(40)
  })

  it('estimates tests without history at the median of the known ones', () => {
    const known = [t('a.spec.ts', ['a']), t('b.spec.ts', ['b']), t('c.spec.ts', ['c'])]
    const fresh = t('new.spec.ts', ['new'])
    const plan = planShards([...known, fresh], { total: 1, durations: durations([[known[0], 100], [known[1], 300], [known[2], 2000]]) })

    expect(plan).toMatchObject({ known: 3, unknown: 1, defaultDuration: 300 })
    expect(plan.shards[0].duration).toBe(2700)
  })

  it('keeps a Playwright project in the entry and splits the same file per project', () => {
    const plan = planShards([t('a.spec.ts', ['x'], 'chromium'), t('a.spec.ts', ['x'], 'firefox')], { total: 2, durations: new Map() })
    expect(plan.shards.flatMap(s => s.entries).sort()).toEqual(['[chromium] › a.spec.ts', '[firefox] › a.spec.ts'])
  })

  it('omits the project when the config has none', () => {
    const plan = planShards([t('a.spec.ts', ['suite', 'x'], '')], { total: 1, durations: new Map(), granularity: 'test' })
    expect(plan.shards[0].entries).toEqual(['a.spec.ts › suite › x'])
  })

  it('splits files per test with the test granularity', () => {
    const tests = [t('a.spec.ts', ['suite', 'one']), t('a.spec.ts', ['suite', 'two'])]
    const plan = planShards(tests, { total: 2, durations: new Map(), granularity: 'test' })
    expect(plan.shards.map(s => s.entries)).toEqual([['[chromium] › a.spec.ts › suite › one'], ['[chromium] › a.spec.ts › suite › two']])
  })

  it('keeps a file whole when a test entry would also match other tests', () => {
    // Playwright matches list entries by title prefix: "login" would also select "login › twice".
    const prefix = [t('a.spec.ts', ['login']), t('a.spec.ts', ['login', 'twice'])]
    const separator = [t('b.spec.ts', ['a › b']), t('b.spec.ts', ['c'])]
    const plan = planShards([...prefix, ...separator], { total: 4, durations: new Map(), granularity: 'test' })
    expect(plan.shards.flatMap(s => s.entries).sort()).toEqual(['[chromium] › a.spec.ts', '[chromium] › b.spec.ts'])
  })

  it('leaves extra shards empty and rejects an invalid total', () => {
    const plan = planShards([t('a.spec.ts', ['x'])], { total: 3, durations: new Map() })
    expect(plan.shards.map(s => s.tests)).toEqual([1, 0, 0])
    expect(() => planShards([], { total: 0, durations: new Map() })).toThrow('positive integer')
  })
})

describe('testListFile', () => {
  it('writes a commented header and one entry per line', () => {
    expect(testListFile({ entries: ['[chromium] › a.spec.ts'], tests: 2, duration: 4600 }, 1, 2))
      .toBe('# kinora shard 1/2: 2 tests, ~5s estimated\n[chromium] › a.spec.ts\n')
  })
})
