import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { createReadClient } from '@kinora/core'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { app } from '../src/app'
import { db } from '../src/db'
import { artifact, project, run, test, testQuarantine } from '../src/db/schemas/index'
import { caller, createApiKey, createUser, ingest, runPayload } from './helpers'

function get(path: string, key: string | null) {
  const headers: Record<string, string> = {}
  if (key)
    headers.Authorization = `Bearer ${key}`
  return app.request(`/api/v1${path}`, { headers })
}

describe('response compression', () => {
  it('gzips JSON for a client that accepts it, and only then', async () => {
    const key = await createApiKey((await createUser('gz@test.dev')).id)
    await ingest(key)
    const latest = (encoding?: string) => app.request('/api/v1/projects/web-app/runs/latest', {
      headers: { Authorization: `Bearer ${key}`, ...(encoding && { 'Accept-Encoding': encoding }) },
    })

    const gzipped = await latest('gzip, deflate, br')
    expect(gzipped.headers.get('content-encoding')).toBe('gzip')
    const body = JSON.parse(new TextDecoder().decode(gunzipSync(Buffer.from(await gzipped.arrayBuffer())))) as { runId: string }
    expect(body.runId).toBeTruthy()

    const plain = await latest()
    expect(plain.headers.get('content-encoding')).toBeNull()
    expect((await plain.json() as { runId: string }).runId).toBe(body.runId)
  })
})

describe('read api auth + scope', () => {
  it('rejects a request with no api key', async () => {
    expect((await get('/projects', null)).status).toBe(401)
  })

  it('lists only the caller org projects with their latest run', async () => {
    const a = await createUser('a@test.dev')
    const b = await createUser('b@test.dev')
    const keyA = await createApiKey(a.id)
    await ingest(keyA)

    const listA = await (await get('/projects', keyA)).json() as { projects: { id: string, latestRun: unknown }[] }
    expect(listA.projects).toHaveLength(1)
    expect(listA.projects[0].id).toBe('web-app')
    expect(listA.projects[0].latestRun).not.toBeNull()

    const listB = await (await get('/projects', await createApiKey(b.id))).json() as { projects: unknown[] }
    expect(listB.projects).toHaveLength(0)
  })

  it('cannot read another org project (404)', async () => {
    const a = await createUser('a@test.dev')
    const b = await createUser('b@test.dev')
    await ingest(await createApiKey(a.id))

    expect((await get('/projects/web-app/runs', await createApiKey(b.id))).status).toBe(404)
  })
})

describe('read api runs', () => {
  it('returns run summaries and 404s an unknown project', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    await ingest(key)

    const { runs } = await (await get('/projects/web-app/runs', key)).json() as { runs: unknown[] }
    expect(runs).toHaveLength(1)
    expect((await get('/projects/nope/runs', key)).status).toBe(404)
  })

  it('resolves latest to the newest run report', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    await ingest(key, runPayload('web-app', '@smoke', 'expected'))
    const head = await (await ingest(key, runPayload('web-app', '@smoke', 'unexpected'))).json() as { runId: string }

    const report = await (await get('/projects/web-app/runs/latest', key)).json() as { runId: string }
    expect(report.runId).toBe(head.runId)
    expect((await get('/projects/web-app/runs/nope', key)).status).toBe(404)
  })
})

describe('read api failures', () => {
  it('returns only failing tests of the latest run', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    await ingest(key, runPayload('web-app', '@smoke', 'expected'))
    await ingest(key, runPayload('web-app', '@smoke', 'unexpected'))

    const r = await (await get('/projects/web-app/failures', key)).json() as { failures: { testKey: string }[] }
    expect(r.failures).toHaveLength(1)
  })

  it('includes flaky tests (ok=true) alongside hard failures', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    await ingest(key, runPayload('web-app', '@smoke', 'flaky'))

    const r = await (await get('/projects/web-app/failures', key)).json() as { failures: { status: string }[] }
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0].status).toBe('flaky')
  })

  it('includes a signed trace url on a failing test', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    const payload = runPayload('web-app', '@smoke', 'unexpected')
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

    const r = await (await get('/projects/web-app/failures', key)).json() as { failures: { attachments: { name: string, url?: string }[] }[] }
    const trace = r.failures[0].attachments.find(x => x.name === 'trace')
    expect(trace?.url).toContain('sig=')
  })
})

describe('read api history', () => {
  it('returns per-test history, filterable by testKey', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    await ingest(key, runPayload('web-app', '@smoke', 'expected'))
    await ingest(key, runPayload('web-app', '@smoke', 'unexpected'))

    const all = await (await get('/projects/web-app/history', key)).json() as { histories: { testKey: string, points: unknown[] }[] }
    expect(all.histories.length).toBeGreaterThan(0)
    expect(all.histories[0].points).toHaveLength(2)

    const one = await (await get(`/projects/web-app/history?testKey=${encodeURIComponent(all.histories[0].testKey)}`, key)).json() as { histories: unknown[] }
    expect(one.histories).toHaveLength(1)
  })
})

describe('read api test durations', () => {
  let minute = 0
  function timed(duration: number, status: 'expected' | 'skipped' = 'expected') {
    const payload = runPayload('web-app', '@smoke', status)
    payload.run.startedAt = new Date(Date.UTC(2026, 0, 1, 0, minute++)).toISOString()
    payload.tests[0].duration = duration
    return payload
  }

  it('returns the median duration per test, leaving out skipped results and incident runs', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    for (const d of [1000, 3000, 2000])
      await ingest(key, timed(d))
    await ingest(key, timed(0, 'skipped'))
    const { runId } = await (await ingest(key, timed(90000))).json() as { runId: string }
    await db.update(run).set({ incident: { rule: 'host-unreachable', reason: 'down' } }).where(eq(run.id, runId))

    const body = await (await get('/projects/web-app/test-durations', key)).json() as { runs: number, tests: { duration: number, samples: number }[] }
    expect(body.runs).toBe(4)
    expect(body.tests).toEqual([expect.objectContaining({ duration: 2000, samples: 3 })])

    const recent = await (await get('/projects/web-app/test-durations?runs=2', key)).json() as { tests: { duration: number, samples: number }[] }
    expect(recent.tests[0]).toMatchObject({ duration: 2000, samples: 1 })
    expect((await get('/projects/nope/test-durations', key)).status).toBe(404)
  })
})

describe('read api quarantines', () => {
  it('lists the active quarantines with the identity of each test', async () => {
    const a = await createUser('a@test.dev')
    const key = await createApiKey(a.id)
    await ingest(key)
    const p = await db.query.project.findFirst({ where: eq(project.slug, 'web-app') })
    const stored = await db.query.test.findFirst({ where: eq(test.projectId, p!.id) })
    const quarantine = (testKey: string, over: Partial<typeof testQuarantine.$inferInsert> = {}) =>
      db.insert(testQuarantine).values({ id: randomUUID(), projectId: p!.id, testKey, ...over })
    await quarantine(stored!.testKey, { reason: 'races the toast' })
    await quarantine('gone.spec.ts::gone.spec.ts › old::chromium')
    await quarantine('expired', { expiresAt: new Date(Date.now() - 60_000) })

    const body = await (await get('/projects/web-app/quarantines', key)).json() as { quarantines: unknown[] }
    expect(body.quarantines).toEqual([
      { testKey: 'gone.spec.ts::gone.spec.ts › old::chromium' },
      { testKey: stored!.testKey, reason: 'races the toast', test: { file: 'tests/checkout.spec.ts', titlePath: ['tests/checkout.spec.ts', 'completes a purchase'], projectName: 'chromium' } },
    ])
    expect((await get('/projects/nope/quarantines', key)).status).toBe(404)
  })
})

describe('read api failure causes', () => {
  async function failingRun(key: string, slug = 'web-app') {
    const payload = runPayload(slug, '@smoke', 'unexpected')
    payload.tests[0].errors = [{ message: 'Error: checkout total is wrong' }]
    expect((await ingest(key, payload)).status).toBe(201)
  }

  it('gives each run failure its cause, with what the team decided', async () => {
    const u = await createUser('a@test.dev')
    const key = await createApiKey(u.id)
    await failingRun(key)
    const api = await caller(u)
    const { clusters: [cluster] } = await api.dashboard.projectHistory({ projectId: 'web-app' })
    await api.dashboard.triageCluster({ projectId: 'web-app', fingerprint: cluster.fingerprint, assigneeId: u.id, issueUrl: 'https://github.com/acme/web/issues/9' })

    const body = await (await get('/projects/web-app/failures', key)).json() as { failures: unknown[], causes: { fingerprint: string, state: string, snoozed: boolean, url: string, triage: { issueUrl: string } }[] }
    expect(body.failures).toHaveLength(1)
    expect(body.causes).toEqual([expect.objectContaining({
      fingerprint: cluster.fingerprint,
      state: 'failing',
      snoozed: false,
      url: expect.stringContaining(`/projects/web-app/tests?cluster=${cluster.fingerprint}`),
      triage: expect.objectContaining({ issueUrl: 'https://github.com/acme/web/issues/9', assignee: { id: u.id, name: u.name } }),
    })])
  })

  it('lists the open causes of every project or one, leaving out the resolved', async () => {
    const u = await createUser('a@test.dev')
    const key = await createApiKey(u.id)
    await failingRun(key, 'web-app')
    await failingRun(key, 'api')
    const api = await caller(u)
    const { clusters: [resolved] } = await api.dashboard.projectHistory({ projectId: 'api' })
    await api.dashboard.triageCluster({ projectId: 'api', fingerprint: resolved.fingerprint, status: 'resolved' })

    const all = await (await get('/causes', key)).json() as { causes: { project: { id: string } }[] }
    expect(all.causes.map(c => c.project.id)).toEqual(['web-app'])
    const one = await (await get('/causes?project=api', key)).json() as { causes: unknown[] }
    expect(one.causes).toEqual([])
    expect((await get('/causes?project=nope', key)).status).toBe(404)
  })

  it('parses with the read client the MCP server uses', async () => {
    const u = await createUser('a@test.dev')
    const key = await createApiKey(u.id)
    await failingRun(key)
    const client = createReadClient({ baseUrl: 'http://kinora.test', token: key, fetch: async (input, init) => app.request(String(input).replace('http://kinora.test', ''), init) })

    const failures = await client.getFailures('web-app')
    expect(failures.causes?.[0]).toMatchObject({ state: 'failing', tests: 1, project: { id: 'web-app' } })
    expect(await client.getOpenCauses()).toHaveLength(1)
  })
})
