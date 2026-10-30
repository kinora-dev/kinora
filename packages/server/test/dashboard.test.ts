import type { Counts, IngestRun } from '@kinora/core'
import { randomUUID } from 'node:crypto'
import { diagnose, makeTestKey, STORY_ANNOTATION } from '@kinora/core'
import { desc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '../src/db'
import { artifact, project, run, test, testQuarantine } from '../src/db/schemas/index'
import { RUN_PAGE_SIZE } from '../src/reports/queries'
import { MAX_DASHBOARD_RUNS } from '../src/router/dashboard'
import { caller, createApiKey, createUser, ingest, runPayload } from './helpers'

describe('dashboard scoping', () => {
  it('manifest only returns the caller own projects', async () => {
    const a = await createUser('a@test.dev')
    const b = await createUser('b@test.dev')
    await ingest(await createApiKey(a.id))

    expect((await (await caller(a)).dashboard.manifest()).projects).toHaveLength(1)
    expect((await (await caller(b)).dashboard.manifest()).projects).toHaveLength(0)
  })

  it('rejects a run query on a project owned by another user', async () => {
    const a = await createUser('a@test.dev')
    const b = await createUser('b@test.dev')
    const { runId } = await (await ingest(await createApiKey(a.id))).json() as { runId: string }

    await expect((await caller(b)).dashboard.run({ projectId: 'web-app', runId })).rejects.toThrow()
  })

  it('rejects projectHistory on a project owned by another user', async () => {
    const a = await createUser('a@test.dev')
    const b = await createUser('b@test.dev')
    await ingest(await createApiKey(a.id))

    await expect((await caller(b)).dashboard.projectHistory({ projectId: 'web-app' })).rejects.toThrow()
  })

  it('manifest caps runs per project at DASHBOARD_MAX_RUNS', async () => {
    const a = await createUser('a@test.dev')
    await ingest(await createApiKey(a.id))
    const p = await db.query.project.findFirst({ where: eq(project.slug, 'web-app') })

    const extra = MAX_DASHBOARD_RUNS + 10
    await db.insert(run).values(Array.from({ length: extra }, () => ({
      id: randomUUID(),
      projectId: p!.id,
      startedAt: new Date(),
      duration: 0,
      counts: { total: 0, expected: 0, unexpected: 0, flaky: 0, skipped: 0 },
    })))

    const m = await (await caller(a)).dashboard.manifest()
    expect(m.projects[0].runs).toHaveLength(MAX_DASHBOARD_RUNS)
  })

  it('manifest exposes countsByTag', async () => {
    const a = await createUser('a@test.dev')
    await ingest(await createApiKey(a.id))

    const m = await (await caller(a)).dashboard.manifest()
    expect(m.projects[0].runs[0].countsByTag['@smoke']?.total).toBe(1)
  })

  it('compareRuns diffs two runs by testKey', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    const base = await (await ingest(key, runPayload('web-app', '@smoke', 'expected'))).json() as { runId: string }
    const head = await (await ingest(key, runPayload('web-app', '@smoke', 'unexpected'))).json() as { runId: string }

    const cmp = await (await caller(a)).dashboard.compareRuns({ projectId: 'web-app', baseRunId: base.runId, headRunId: head.runId })
    const broken = cmp.tests.find(t => t.change === 'broken')
    expect(broken?.baseStatus).toBe('expected')
    expect(broken?.headStatus).toBe('unexpected')
  })

  it('rejects compareRuns on a project owned by another user', async () => {
    const a = await createUser('a@test.dev')
    const b = await createUser('b@test.dev')
    const key = await createApiKey(a.id)
    const base = await (await ingest(key, runPayload('web-app'))).json() as { runId: string }
    const head = await (await ingest(key, runPayload('web-app'))).json() as { runId: string }

    await expect((await caller(b)).dashboard.compareRuns({ projectId: 'web-app', baseRunId: base.runId, headRunId: head.runId }))
      .rejects
      .toThrow()
  })
})

describe('dashboard overview', () => {
  const MINUTE = 60_000

  async function seed(runs: { counts?: Partial<Counts>, branch?: string, countsByTag?: Record<string, Counts>, incident?: boolean }[]) {
    const a = await createUser('a@test.dev')
    await ingest(await createApiKey(a.id), runPayload('web-app', '@smoke', 'expected'))
    const p = await db.query.project.findFirst({ where: eq(project.slug, 'web-app') })
    const now = Date.now()
    if (runs.length) {
      await db.insert(run).values(runs.map((r, i) => ({
        id: randomUUID(),
        projectId: p!.id,
        startedAt: new Date(now - (i + 1) * MINUTE),
        duration: 0,
        counts: { total: 10, expected: 10, unexpected: 0, flaky: 0, skipped: 0, ...r.counts },
        countsByTag: r.countsByTag ?? {},
        git: r.branch ? { branch: r.branch } : undefined,
        incident: r.incident ? { rule: 'manual' as const, reason: 'Staging down.' } : undefined,
      })))
    }
    return a
  }

  it('returns the latest runs, the full run count and a downsampled trend that keeps failures', async () => {
    const a = await seed(Array.from({ length: 120 }, (_, i) => (i === 60 ? { counts: { expected: 2, unexpected: 8 } } : {})))

    const [p] = (await (await caller(a)).dashboard.overview()).projects
    expect(p.runCount).toBe(121)
    expect(p.runs).toHaveLength(20)
    expect(p.runs.map(r => r.startedAt)).toEqual([...p.runs.map(r => r.startedAt)].sort().reverse())
    expect(p.trend).toHaveLength(50)
    expect(p.trend.filter(t => t.passRate < 1)).toHaveLength(1)
  })

  it('counts every run but only draws the dashboard window', async () => {
    const a = await seed(Array.from({ length: MAX_DASHBOARD_RUNS + 10 }, () => ({})))

    const [p] = (await (await caller(a)).dashboard.overview()).projects
    expect(p.runCount).toBe(MAX_DASHBOARD_RUNS + 11)
    expect(p.trend).toHaveLength(50)
  })

  it('filters by branch and lists the branches', async () => {
    const a = await seed([{ branch: 'main' }, { branch: 'main' }, { branch: 'feat/x', counts: { expected: 9, unexpected: 1 } }])
    const overview = (await caller(a)).dashboard.overview

    expect((await overview()).branches).toEqual(['feat/x', 'main'])
    expect((await overview({ branch: 'main' })).branches).toEqual(['feat/x', 'main'])
    const [main] = (await overview({ branch: 'main' })).projects
    expect(main.runCount).toBe(2)
    expect(main.runs.map(r => r.git?.branch)).toEqual(['main', 'main'])
  })

  it('filters by tag with the tag counts and lists the tags', async () => {
    const slow = { total: 2, expected: 1, unexpected: 1, flaky: 0, skipped: 0 }
    const a = await seed([{ countsByTag: { '@slow': slow } }, {}])
    const overview = (await caller(a)).dashboard.overview

    expect((await overview()).tags).toEqual(['@slow', '@smoke'])
    expect((await overview({ tag: '@slow' })).tags).toEqual(['@slow', '@smoke'])
    const [p] = (await overview({ tag: '@slow' })).projects
    expect(p.runCount).toBe(1)
    expect(p.runs[0].counts).toEqual(slow)
    expect(p.trend[0].passRate).toBe(0.5)
  })

  it('carries environment incidents into the trend', async () => {
    const a = await seed([{ counts: { expected: 0, unexpected: 10 }, incident: true }])

    const [p] = (await (await caller(a)).dashboard.overview()).projects
    expect(p.trend).toEqual([{ passRate: 0, incident: 'Staging down.' }, { passRate: 1 }])
  })

  it('keeps projects without a matching run, with no runs', async () => {
    const a = await seed([])

    const [p] = (await (await caller(a)).dashboard.overview({ branch: 'nope' })).projects
    expect(p).toMatchObject({ id: 'web-app', runCount: 0, runs: [], trend: [] })
  })

  it('only returns the caller own projects', async () => {
    const a = await seed([])
    const b = await createUser('b@test.dev')

    expect((await (await caller(a)).dashboard.overview()).projects).toHaveLength(1)
    expect(await (await caller(b)).dashboard.overview()).toMatchObject({ projects: [], branches: [], tags: [] })
  })
})

describe('dashboard project runs', () => {
  const MINUTE = 60_000

  async function seed(n: number, startedAt = (i: number, now: number) => new Date(now - (i + 1) * MINUTE)) {
    const a = await createUser('a@test.dev')
    await ingest(await createApiKey(a.id), runPayload('web-app', '@smoke', 'expected'))
    const p = await db.query.project.findFirst({ where: eq(project.slug, 'web-app') })
    const now = Date.now()
    await db.insert(run).values(Array.from({ length: n }, (_, i) => ({
      id: randomUUID(),
      projectId: p!.id,
      startedAt: startedAt(i, now),
      duration: 0,
      counts: { total: 1, expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
    })))
    const all = await db.select({ id: run.id }).from(run).where(eq(run.projectId, p!.id)).orderBy(desc(run.startedAt), desc(run.id))
    return { a, ids: all.map(r => r.id) }
  }

  it('pages every run newest first, older and back newer', async () => {
    const { a, ids } = await seed(MAX_DASHBOARD_RUNS + 9)
    const projectRuns = (await caller(a)).dashboard.projectRuns

    const seen: string[] = []
    let page = await projectRuns({ projectId: 'web-app' })
    expect(page.newer).toBeUndefined()
    while (true) {
      seen.push(...page.runs.map(r => r.runId))
      if (!page.older)
        break
      page = await projectRuns({ projectId: 'web-app', before: page.older })
    }
    expect(seen).toEqual(ids)

    const second = await projectRuns({ projectId: 'web-app', before: ids[RUN_PAGE_SIZE - 1] })
    expect((await projectRuns({ projectId: 'web-app', after: second.newer! })).runs.map(r => r.runId)).toEqual(ids.slice(0, RUN_PAGE_SIZE))
  })

  it('orders runs that started at the same time by id', async () => {
    const at = new Date()
    const { a, ids } = await seed(RUN_PAGE_SIZE + 5, () => at)
    const projectRuns = (await caller(a)).dashboard.projectRuns

    const first = await projectRuns({ projectId: 'web-app' })
    const second = await projectRuns({ projectId: 'web-app', before: first.older! })
    expect([...first.runs, ...second.runs].map(r => r.runId)).toEqual(ids)
  })

  it('fills a newer page near the top and starts over on an unknown cursor', async () => {
    const { a, ids } = await seed(RUN_PAGE_SIZE + 5)
    const projectRuns = (await caller(a)).dashboard.projectRuns

    expect((await projectRuns({ projectId: 'web-app', after: ids[3] })).runs.map(r => r.runId)).toEqual(ids.slice(0, RUN_PAGE_SIZE))
    for (const cursor of [{ before: 'gone' }, { after: 'gone' }]) {
      const page = await projectRuns({ projectId: 'web-app', ...cursor })
      expect(page.runs.map(r => r.runId)).toEqual(ids.slice(0, RUN_PAGE_SIZE))
      expect(page.newer).toBeUndefined()
    }
  })

  it('summarizes the project with its full run count', async () => {
    const { a } = await seed(MAX_DASHBOARD_RUNS + 9)

    const summary = await (await caller(a)).dashboard.projectSummary({ projectId: 'web-app' })
    expect(summary).toMatchObject({ id: 'web-app', runCount: MAX_DASHBOARD_RUNS + 10 })
    expect(summary.runs).toHaveLength(20)
    expect(summary.trend).toHaveLength(50)
  })

  it('hides another workspace project', async () => {
    await seed(1)
    const b = await createUser('b@test.dev')

    await expect((await caller(b)).dashboard.projectRuns({ projectId: 'web-app' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect((await caller(b)).dashboard.projectSummary({ projectId: 'web-app' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('dashboard analytics', () => {
  const DAY = 86_400_000
  const day = (d: Date) => d.toISOString().slice(0, 10)

  // An ingest creates the project; the extra runs are inserted directly to backdate them.
  async function seed(runs: { daysAgo: number, counts: Partial<Counts>, branch?: string, incident?: boolean }[]) {
    const a = await createUser('a@test.dev')
    await ingest(await createApiKey(a.id), runPayload('web-app', '@smoke', 'expected'))
    const p = await db.query.project.findFirst({ where: eq(project.slug, 'web-app') })
    const now = Date.now()
    if (!runs.length)
      return { a, now }
    await db.insert(run).values(runs.map(r => ({
      id: randomUUID(),
      projectId: p!.id,
      startedAt: new Date(now - r.daysAgo * DAY),
      duration: 0,
      counts: { total: 0, expected: 0, unexpected: 0, flaky: 0, skipped: 0, ...r.counts },
      git: r.branch ? { branch: r.branch } : undefined,
      incident: r.incident ? { rule: 'manual' as const, reason: 'Staging down.' } : undefined,
    })))
    return { a, now }
  }

  it('sums run outcomes per day over the range, oldest first', async () => {
    const { a, now } = await seed([
      { daysAgo: 3, counts: { expected: 8, flaky: 1, unexpected: 1 } },
      { daysAgo: 3, counts: { expected: 9, skipped: 1 }, incident: true },
      { daysAgo: 45, counts: { expected: 5 } },
    ])

    const res = await (await caller(a)).dashboard.analytics({ projectId: 'web-app' })
    expect(res).toMatchObject({ days: 30, bucket: 'day' })
    expect(res.outcomes).toEqual([
      { date: day(new Date(now - 3 * DAY)), runs: 2, expected: 17, flaky: 1, unexpected: 1, skipped: 1, incidents: 1 },
      { date: day(new Date(now)), runs: 1, expected: 1, flaky: 0, unexpected: 0, skipped: 0, incidents: 0 },
    ])
  })

  it('reads the 90 day range per week', async () => {
    const { a } = await seed([{ daysAgo: 45, counts: { unexpected: 2 } }, { daysAgo: 120, counts: { unexpected: 7 } }])

    const res = await (await caller(a)).dashboard.analytics({ projectId: 'web-app', days: 90 })
    expect(res.bucket).toBe('week')
    expect(res.outcomes.reduce((n, b) => n + b.unexpected, 0)).toBe(2)
    expect(res.outcomes.reduce((n, b) => n + b.runs, 0)).toBe(2)
  })

  it('filters by branch and lists the branches of the range', async () => {
    const { a } = await seed([
      { daysAgo: 1, counts: { expected: 3 }, branch: 'main' },
      { daysAgo: 2, counts: { unexpected: 4 }, branch: 'feat/x' },
      { daysAgo: 60, counts: { expected: 1 }, branch: 'old' },
    ])
    const analytics = (await caller(a)).dashboard.analytics

    expect((await analytics({ projectId: 'web-app' })).branches).toEqual(['feat/x', 'main'])
    const main = await analytics({ projectId: 'web-app', branch: 'main' })
    expect(main.outcomes).toHaveLength(1)
    expect(main.outcomes[0]).toMatchObject({ runs: 1, expected: 3, unexpected: 0 })
  })

  it('buckets runs by day in the viewer time zone', async () => {
    const { a } = await seed([])
    const p = await db.query.project.findFirst({ where: eq(project.slug, 'web-app') })
    // 23:30 UTC two days ago is already the next day in Paris (UTC+1 or +2).
    const late = new Date(Date.now() - 2 * DAY)
    late.setUTCHours(23, 30, 0, 0)
    await db.insert(run).values({
      id: randomUUID(),
      projectId: p!.id,
      startedAt: late,
      duration: 0,
      counts: { total: 1, expected: 0, unexpected: 1, flaky: 0, skipped: 0 },
    })
    const analytics = (await caller(a)).dashboard.analytics
    const failedOn = async (timeZone: string) => (await analytics({ projectId: 'web-app', timeZone })).outcomes.find(b => b.unexpected)?.date

    expect(await failedOn('UTC')).toBe(day(late))
    expect(await failedOn('Europe/Paris')).toBe(day(new Date(late.getTime() + DAY)))
    // Legacy name browsers report, missing from the Debian tzdata Postgres reads (Asia/Kolkata there).
    expect(await failedOn('Asia/Calcutta')).toBe(day(new Date(late.getTime() + DAY)))
  })

  it('rejects a time zone that is not an IANA name', async () => {
    const { a } = await seed([])
    const analytics = (await caller(a)).dashboard.analytics

    await expect(analytics({ projectId: 'web-app', timeZone: 'UTC\'; drop table run; --' })).rejects.toThrow()
    await expect(analytics({ projectId: 'web-app', timeZone: 'Mars/Olympus' })).rejects.toThrow()
  })

  it('rejects analytics on a project owned by another user', async () => {
    await seed([])
    const b = await createUser('b@test.dev')

    await expect((await caller(b)).dashboard.analytics({ projectId: 'web-app' })).rejects.toThrow()
  })
})

// A one-test run of `slug` whose test is `title` in `file`.
function testRun(slug: string, file: string, title: string, status: 'expected' | 'unexpected' = 'expected') {
  const payload = runPayload(slug, '@smoke', status)
  const titlePath = [file, 'checkout', title]
  payload.tests[0] = { ...payload.tests[0], file, title, titlePath, testKey: makeTestKey(file, titlePath, 'chromium') }
  return payload
}

describe('dashboard test search', () => {
  it('finds tests across projects by file, suite and title words', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    await ingest(key, testRun('web-app', 'tests/cart.spec.ts', 'adds an item'))
    await ingest(key, testRun('admin', 'tests/orders.spec.ts', 'refunds an item'))
    const search = (await caller(a)).dashboard.searchTests

    expect((await search({ q: 'ITEM' })).map(h => h.projectId).sort()).toEqual(['admin', 'web-app'])
    // Every word has to match, in any order and in any part of the path.
    expect((await search({ q: 'item cart checkout' })).map(h => h.title)).toEqual(['adds an item'])
    expect(await search({ q: 'item missing' })).toEqual([])
    // The project narrows a query down too.
    expect((await search({ q: 'item admin' })).map(h => h.title)).toEqual(['refunds an item'])
  })

  it('returns a test once, with its status in the newest run', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    await ingest(key, testRun('web-app', 'tests/cart.spec.ts', 'adds an item', 'expected'))
    const { runId } = await (await ingest(key, testRun('web-app', 'tests/cart.spec.ts', 'adds an item', 'unexpected'))).json() as { runId: string }

    const hits = await (await caller(a)).dashboard.searchTests({ q: 'adds' })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ projectId: 'web-app', projectName: 'web-app', status: 'unexpected', runId })
  })

  it('lists the preferred project first', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    await ingest(key, testRun('admin', 'tests/orders.spec.ts', 'refunds an item'))
    await ingest(key, testRun('web-app', 'tests/cart.spec.ts', 'adds an item'))
    const search = (await caller(a)).dashboard.searchTests

    expect((await search({ q: 'item' })).map(h => h.projectId)).toEqual(['web-app', 'admin'])
    expect((await search({ q: 'item', projectId: 'admin' })).map(h => h.projectId)).toEqual(['admin', 'web-app'])
  })

  it('matches LIKE wildcards literally', async () => {
    const a = await createUser('a@test.dev')
    await ingest(await createApiKey(a.id), testRun('web-app', 'tests/cart.spec.ts', 'applies a 10% discount'))
    const search = (await caller(a)).dashboard.searchTests

    expect(await search({ q: '10%' })).toHaveLength(1)
    expect(await search({ q: 'a_p' })).toEqual([])
    expect(await search({ q: '%%' })).toEqual([])
  })

  it('never returns the tests of another workspace', async () => {
    const a = await createUser('a@test.dev')
    const b = await createUser('b@test.dev')
    await ingest(await createApiKey(a.id), testRun('web-app', 'tests/cart.spec.ts', 'adds an item'))

    expect(await (await caller(b)).dashboard.searchTests({ q: 'item', projectId: 'web-app' })).toEqual([])
  })
})

describe('dashboard quarantine', () => {
  it('creates, updates, lists and removes a test quarantine', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    const payload = runPayload('web-app', '@smoke', 'flaky')
    await ingest(key, payload)

    const api = await caller(a)
    const first = await api.dashboard.quarantine({ projectId: 'web-app', testKey: payload.tests[0].testKey, reason: 'known noisy checkout' })
    expect(first.reason).toBe('known noisy checkout')

    await api.dashboard.quarantine({ projectId: 'web-app', testKey: payload.tests[0].testKey, reason: 'muted until fixed' })
    expect(await api.dashboard.quarantines({ projectId: 'web-app' })).toMatchObject([
      { testKey: payload.tests[0].testKey, reason: 'muted until fixed' },
    ])
    const row = await db.query.testQuarantine.findFirst({ where: eq(testQuarantine.testKey, payload.tests[0].testKey) })
    expect(row).toMatchObject({ createdByUserId: a.id, updatedByUserId: a.id })

    await api.dashboard.unquarantine({ projectId: 'web-app', testKey: payload.tests[0].testKey })
    expect(await api.dashboard.quarantines({ projectId: 'web-app' })).toHaveLength(0)
  })

  it('does not expose expired quarantines', async () => {
    const a = await createUser('a@test.dev')
    const payload = runPayload('web-app')
    await ingest(await createApiKey(a.id), payload)

    const api = await caller(a)
    await api.dashboard.quarantine({ projectId: 'web-app', testKey: payload.tests[0].testKey, expiresAt: new Date(Date.now() - 1000).toISOString() })

    expect(await api.dashboard.quarantines({ projectId: 'web-app' })).toHaveLength(0)
  })

  it('rejects quarantine writes on a project owned by another user', async () => {
    const a = await createUser('a@test.dev')
    const b = await createUser('b@test.dev')
    const payload = runPayload('web-app')
    await ingest(await createApiKey(a.id), payload)

    await expect((await caller(b)).dashboard.quarantine({ projectId: 'web-app', testKey: payload.tests[0].testKey })).rejects.toThrow()
  })
})

describe('dashboard reads', () => {
  it('run returns the report with the run tests', async () => {
    const a = await createUser('a@test.dev')
    const { runId } = await (await ingest(await createApiKey(a.id))).json() as { runId: string }

    const report = await (await caller(a)).dashboard.run({ projectId: 'web-app', runId })
    expect(report.runId).toBe(runId)
    expect(report.tests).toHaveLength(1)
    expect(report.tests[0].title).toBe('completes a purchase')
  })

  it('run includes matched code owners on tests', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    const payload = runPayload('web-app')
    await ingest(key, payload)
    await (await caller(a)).project.updateCodeowners({ projectId: 'web-app', text: '/tests/** @checkout @qa' })
    const { runId } = await (await ingest(key, payload)).json() as { runId: string }

    const report = await (await caller(a)).dashboard.run({ projectId: 'web-app', runId })
    expect(report.tests[0].codeOwners).toEqual(['@checkout', '@qa'])
  })

  it('projectHistory includes matched code owners on histories', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    await ingest(key, runPayload('web-app'))
    await (await caller(a)).project.updateCodeowners({ projectId: 'web-app', text: '*.spec.ts @qa' })

    const h = await (await caller(a)).dashboard.projectHistory({ projectId: 'web-app' })
    expect(h.histories[0].codeOwners).toEqual(['@qa'])
  })

  it('run merges a signed artifact url onto the matching test attachment', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    const payload = runPayload('web-app')
    payload.tests[0].attachments = [{ name: 'trace', contentType: 'application/zip', hasBody: true }]
    const { runId } = await (await ingest(key, payload)).json() as { runId: string }

    const p = await db.query.project.findFirst({ where: eq(project.slug, 'web-app') })
    const t = await db.query.test.findFirst({ where: eq(test.runId, runId) })
    await db.insert(artifact).values({
      id: randomUUID(),
      projectId: p!.id,
      runId,
      testId: t!.id,
      name: 'trace',
      contentType: 'application/zip',
      storageKey: `${p!.id}/${runId}/trace.zip`,
      size: 4,
    })

    const report = await (await caller(a)).dashboard.run({ projectId: 'web-app', runId })
    const att = report.tests[0].attachments.find(x => x.name === 'trace')
    expect(att?.url).toBeDefined()
    expect(att!.url).toContain('sig=') // resolved to a signed absolute URL at read time
  })

  it('testAttachments signs the artifacts of one test in one run, and stays scoped', async () => {
    const a = await createUser('a@test.dev')
    const b = await createUser('b@test.dev')
    const payload = runPayload('web-app', '@smoke', 'unexpected')
    payload.tests[0].attachments = ['expected', 'actual', 'diff'].map(part => ({ name: `button-${part}.png`, contentType: 'image/png', hasBody: true }))
    const { runId } = await (await ingest(await createApiKey(a.id), payload)).json() as { runId: string }

    const p = await db.query.project.findFirst({ where: eq(project.slug, 'web-app') })
    const t = await db.query.test.findFirst({ where: eq(test.runId, runId) })
    await db.insert(artifact).values({ id: randomUUID(), projectId: p!.id, runId, testId: t!.id, name: 'button-diff.png', contentType: 'image/png', storageKey: `${p!.id}/${runId}/diff.png`, size: 4 })

    const input = { projectId: 'web-app', runId, testKey: t!.testKey }
    const attachments = await (await caller(a)).dashboard.testAttachments(input)
    expect(attachments.map(x => x.name)).toEqual(['button-expected.png', 'button-actual.png', 'button-diff.png'])
    expect(attachments.find(x => x.name === 'button-diff.png')?.url).toContain('sig=')
    expect(attachments.find(x => x.name === 'button-actual.png')?.url).toBeUndefined()

    // The history flags that run, without carrying any url.
    const h = await (await caller(a)).dashboard.projectHistory({ projectId: 'web-app' })
    expect(h.histories[0].points.at(-1)?.screenshots).toBe(1)

    await expect((await caller(a)).dashboard.testAttachments({ ...input, testKey: 'nope' })).rejects.toThrow(/not found/i)
    await expect((await caller(b)).dashboard.testAttachments(input)).rejects.toThrow()
  })

  it('run throws NOT_FOUND for an unknown run on an owned project', async () => {
    const a = await createUser('a@test.dev')
    await ingest(await createApiKey(a.id))

    await expect((await caller(a)).dashboard.run({ projectId: 'web-app', runId: 'nope' })).rejects.toThrow(/not found/i)
  })

  it('projectHistory exposes the component stories a test mounted', async () => {
    const a = await createUser('a@test.dev')
    const payload = runPayload('web-app')
    payload.tests[0].annotations = [
      { type: STORY_ANNOTATION, description: 'components/Button/Primary' },
      { type: STORY_ANNOTATION, description: 'components/Button/Disabled' },
    ]
    await ingest(await createApiKey(a.id), payload)

    const h = await (await caller(a)).dashboard.projectHistory({ projectId: 'web-app' })
    expect(h.histories[0].stories).toEqual(['components/Button/Primary', 'components/Button/Disabled'])
  })

  it('projectHistory returns per-test histories across the project runs', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    await ingest(key, runPayload('web-app', '@smoke', 'expected'))
    await ingest(key, runPayload('web-app', '@smoke', 'unexpected'))

    const h = await (await caller(a)).dashboard.projectHistory({ projectId: 'web-app' })
    expect(h.project?.id).toBe('web-app')
    expect(h.histories.length).toBeGreaterThan(0)
    expect(h.histories[0].points).toHaveLength(2)
  })

  it('projectHistory trims points to what health reads, testHistory keeps them all', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    const statuses = [
      ...Array.from({ length: 40 }, () => 'expected' as const),
      'flaky' as const,
      ...Array.from({ length: 30 }, () => 'expected' as const),
      // A failing streak longer than the health window: diagnose dates it from its first failure.
      ...Array.from({ length: 25 }, () => 'unexpected' as const),
    ]
    for (const [i, status] of statuses.entries()) {
      const payload = runPayload('web-app', '@smoke', status)
      payload.run.startedAt = new Date(Date.UTC(2026, 0, 1, i)).toISOString()
      await ingest(key, payload)
    }

    const [listed] = (await (await caller(a)).dashboard.projectHistory({ projectId: 'web-app' })).histories
    const full = (await (await caller(a)).dashboard.testHistory({ projectId: 'web-app', testKey: listed.testKey })).history!
    expect(full.points).toHaveLength(statuses.length)
    expect(listed.points).toHaveLength(25)
    expect(diagnose(listed.points)).toEqual(diagnose(full.points))
    expect({ ...listed, points: [] }).toEqual({ ...full, points: [] })
    expect(listed).toMatchObject({ runs: 96, failed: 25, flaky: 1, newlyBroken: false, lastStatus: 'unexpected' })

    expect((await (await caller(a)).dashboard.testHistory({ projectId: 'web-app', testKey: 'nope' })).history).toBeNull()
  })

  it('testHistory returns the clusters the test shares, with the titles of the other tests', async () => {
    const a = await createUser('a@test.dev')
    const payload = runPayload('web-app', '@smoke', 'unexpected')
    const [base] = payload.tests
    const failing = (title: string) => {
      const titlePath = [base.file, title]
      return { ...base, title, titlePath, testKey: makeTestKey(base.file, titlePath, 'chromium'), errors: [{ message: 'Error: connection refused' }] }
    }
    payload.tests = [failing('checks out'), failing('pays'), { ...failing('logs in'), errors: [{ message: 'Error: timeout' }] }]
    payload.run.counts = { total: 3, expected: 0, unexpected: 3, flaky: 0, skipped: 0 }
    await ingest(await createApiKey(a.id), payload)

    const page = await (await caller(a)).dashboard.testHistory({ projectId: 'web-app', testKey: payload.tests[0].testKey })
    expect(page.project.id).toBe('web-app')
    expect(page.clusters).toHaveLength(1)
    expect(page.clusters[0].testKeys.sort()).toEqual([payload.tests[0].testKey, payload.tests[1].testKey].sort())
    expect(page.titles[payload.tests[1].testKey]).toEqual({ title: 'pays', titlePath: [base.file, 'pays'] })
  })

  it('componentHistory only reads the tests that mount stories', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    await ingest(key, runPayload('api'))
    expect((await (await caller(a)).dashboard.componentHistory({ projectId: 'api' })).histories).toEqual([])

    const payload = runPayload('web-app')
    const [plain] = payload.tests
    const titlePath = [plain.file, 'renders the button']
    payload.tests.push({ ...plain, title: 'renders the button', titlePath, testKey: makeTestKey(plain.file, titlePath, 'chromium'), annotations: [{ type: STORY_ANNOTATION, description: 'components/Button/Primary' }] })
    await ingest(key, payload)

    const h = await (await caller(a)).dashboard.componentHistory({ projectId: 'web-app' })
    expect(h.histories.map(x => x.title)).toEqual(['renders the button'])
    expect(h.histories[0].stories).toEqual(['components/Button/Primary'])
    expect(h.clusters).toEqual([])
  })

  it('run returns the a11y report of a test, and drops a malformed one without rejecting the run', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    const a11y = {
      status: 'warning',
      violations: [{ id: 'button-name', impact: 'critical', help: 'Buttons must have discernible text', helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/button-name', nodes: ['#root > button'], nodeCount: 1 }],
    } as const
    const withA11y = (report: unknown) => {
      const payload = runPayload('web-app')
      return { ...payload, tests: [{ ...payload.tests[0], a11y: report }] } as IngestRun
    }
    const good = await (await ingest(key, withA11y(a11y))).json() as { runId: string }
    const bad = await ingest(key, withA11y({ status: 'nope', violations: 'x' }))
    expect(bad.status).toBe(201)

    const dashboard = (await caller(a)).dashboard
    expect((await dashboard.run({ projectId: 'web-app', runId: good.runId })).tests[0].a11y).toEqual(a11y)
    const { runId } = await bad.json() as { runId: string }
    expect((await dashboard.run({ projectId: 'web-app', runId })).tests[0].a11y).toBeUndefined()
  })

  it('ignores an expired flag sent by a client: only the retention sets it', async () => {
    const a = await createUser('a@test.dev')
    const payload = runPayload('web-app')
    const sent = { ...payload, tests: [{ ...payload.tests[0], attachments: [{ name: 'trace', contentType: 'application/zip', hasBody: false, expired: true }] }] } as IngestRun
    const { runId } = await (await ingest(await createApiKey(a.id), sent)).json() as { runId: string }

    const { tests } = await (await caller(a)).dashboard.run({ projectId: 'web-app', runId })
    expect(tests[0].attachments).toEqual([{ name: 'trace', contentType: 'application/zip', hasBody: false }])
  })

  it('projectHistory stamps each point with the commit of its run, for flaky detection', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    const onCommit = (status: 'expected' | 'unexpected') => {
      const payload = runPayload('web-app', '@smoke', status)
      return { ...payload, run: { ...payload.run, git: { sha: 'abc1234' } } }
    }
    await ingest(key, onCommit('expected'))
    await ingest(key, onCommit('unexpected'))

    const [h] = (await (await caller(a)).dashboard.projectHistory({ projectId: 'web-app' })).histories
    expect(h.points.map(p => p.sha)).toEqual(['abc1234', 'abc1234'])
  })

  it('projectHistory clusters failing tests by error signature', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    // Same failure across two runs, varying only by timeout -> one signature.
    const p1 = runPayload('web-app', '@smoke', 'unexpected')
    p1.tests[0].errors = [{ message: 'TimeoutError: locator.click: Timeout 30000ms exceeded' }]
    const p2 = runPayload('web-app', '@smoke', 'unexpected')
    p2.tests[0].errors = [{ message: 'TimeoutError: locator.click: Timeout 15000ms exceeded' }]
    await ingest(key, p1)
    await ingest(key, p2)

    const h = await (await caller(a)).dashboard.projectHistory({ projectId: 'web-app' })
    expect(h.clusters).toHaveLength(1)
    expect(h.clusters[0].count).toBe(2) // two occurrences
    expect(h.clusters[0].tests).toBe(1) // one distinct test
    expect(h.clusters[0].title).toContain('TimeoutError')
  })

  it('compareRuns throws NOT_FOUND when a run id is unknown', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    const base = await (await ingest(key, runPayload('web-app'))).json() as { runId: string }

    await expect((await caller(a)).dashboard.compareRuns({ projectId: 'web-app', baseRunId: base.runId, headRunId: 'nope' }))
      .rejects
      .toThrow(/not found/i)
  })
})
