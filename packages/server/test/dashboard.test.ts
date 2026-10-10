import { randomUUID } from 'node:crypto'
import { STORY_ANNOTATION } from '@kinora/core'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '../src/db'
import { artifact, project, run, test, testQuarantine } from '../src/db/schemas/index'
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
