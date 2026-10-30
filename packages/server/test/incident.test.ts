import type { IngestRun, NormTest } from '@kinora/core'
import { makeTestKey } from '@kinora/core'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { buildAlertEmail } from '../src/alerts/email'
import { buildSlackMessage } from '../src/alerts/slack'
import { app } from '../src/app'
import { db } from '../src/db'
import { run } from '../src/db/schemas/index'
import { caller, createApiKey, createUser, ingest } from './helpers'

const BASE_URL = 'https://staging.example.test'
const REFUSED = `Error: page.goto: net::ERR_CONNECTION_REFUSED at ${BASE_URL}/login`

function suite(status: NormTest['status'], extra: Partial<IngestRun['run']> = {}, message = REFUSED): IngestRun {
  const file = 'tests/checkout.spec.ts'
  const tests: NormTest[] = Array.from({ length: 4 }, (_, i) => {
    const titlePath = [file, `case ${i}`]
    return {
      testKey: makeTestKey(file, titlePath, 'chromium'),
      title: `case ${i}`,
      titlePath,
      file,
      line: i + 1,
      column: 1,
      projectName: 'chromium',
      status,
      ok: status !== 'unexpected',
      duration: 10,
      retries: 0,
      tags: [],
      annotations: [],
      errors: status === 'unexpected' ? [{ message }] : [],
      attachments: [],
    }
  })
  const counts = { total: 4, expected: 0, unexpected: 0, flaky: 0, skipped: 0 }
  counts[status] = 4
  return {
    project: { slug: 'web-app', name: 'web-app' },
    run: { startedAt: new Date().toISOString(), duration: 40, counts, git: { branch: 'main' }, baseUrls: [BASE_URL], ...extra },
    tests,
  }
}

const later = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()

describe('environment incidents', () => {
  it('flags a run whose failures could not reach the app and returns it to the uploader', async () => {
    const key = await createApiKey((await createUser()).id)
    const res = await ingest(key, suite('unexpected'))
    expect(res.status).toBe(201)
    const body = await res.json() as { runId: string, incident?: { rule: string, host?: string } }
    expect(body.incident).toMatchObject({ rule: 'host-unreachable', host: 'staging.example.test' })

    const stored = await db.query.run.findFirst({ where: eq(run.id, body.runId) })
    expect(stored?.incident?.rule).toBe('host-unreachable')
  })

  it('leaves failing assertions counted', async () => {
    const key = await createApiKey((await createUser()).id)
    const res = await ingest(key, suite('unexpected', {}, 'Error: expect(locator).toBeVisible() failed'))
    const body = await res.json() as { incident?: unknown }
    expect(body.incident).toBeUndefined()
  })

  it('keeps an incident out of the regression baseline and of test histories', async () => {
    const user = await createUser()
    const key = await createApiKey(user.id)
    await ingest(key, suite('expected', { startedAt: later(0) }))
    await ingest(key, suite('unexpected', { startedAt: later(1) }))

    // Compared with the green run before the outage, not with the outage: nothing "fixed".
    const res = await app.request('/api/v1/runs?regression=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify(suite('expected', { startedAt: later(2) })),
    })
    const body = await res.json() as { regression?: { base: string, fixed: number } }
    expect(body.regression).toMatchObject({ base: 'previous-run', fixed: 0 })

    const history = await (await caller(user)).dashboard.projectHistory({ projectId: 'web-app' })
    expect(history.project?.runs).toHaveLength(3)
    expect(history.histories[0].points).toHaveLength(2)
    expect(history.histories[0].failed).toBe(0)
    expect(history.clusters).toHaveLength(0)
  })

  it('lets someone clear the flag, and keeps that decision', async () => {
    const user = await createUser()
    const key = await createApiKey(user.id)
    const { runId } = await (await ingest(key, suite('unexpected'))).json() as { runId: string }
    const trpc = await caller(user)

    const state = await trpc.dashboard.setRunIncident({ projectId: 'web-app', runId, flagged: false })
    expect(state.incident).toBeUndefined()
    expect(state.incidentDecision).toMatchObject({ flagged: false })

    const history = await trpc.dashboard.projectHistory({ projectId: 'web-app' })
    expect(history.histories[0].failed).toBe(1)
  })

  it('lets someone mark a run the rules missed', async () => {
    const user = await createUser()
    const key = await createApiKey(user.id)
    const { runId } = await (await ingest(key, suite('unexpected', {}, 'Error: expect(locator).toBeVisible() failed'))).json() as { runId: string }

    const state = await (await caller(user)).dashboard.setRunIncident({ projectId: 'web-app', runId, flagged: true, reason: 'Payment sandbox down' })
    expect(state.incident).toEqual({ rule: 'manual', reason: 'Payment sandbox down' })
    const report = await (await caller(user)).dashboard.run({ projectId: 'web-app', runId })
    expect(report.meta.incident?.rule).toBe('manual')
  })

  it('judges a grouped run once its last shard landed', async () => {
    const key = await createApiKey((await createUser()).id)
    const shard = (current: number) => suite('unexpected', { groupKey: 'ci-1', shard: { current, total: 2 } })

    const first = await (await ingest(key, shard(1))).json() as { incident?: unknown }
    expect(first.incident).toBeUndefined()
    const second = await (await ingest(key, shard(2))).json() as { incident?: { rule: string } }
    expect(second.incident?.rule).toBe('host-unreachable')
  })
})

describe('incident alerts', () => {
  const payload = {
    projectName: 'Web',
    runUrl: 'https://app.kinora.dev/r',
    counts: { total: 4, expected: 0, unexpected: 4, flaky: 0, skipped: 0 },
    newlyFailing: [],
    newlyFlaky: [],
    incident: { rule: 'host-unreachable' as const, reason: '4 of 4 tests failed, 4 of them navigating or connecting to staging.example.test (connection refused).', host: 'staging.example.test' },
  }

  it('names the outage on Slack and by email', () => {
    const slack = buildSlackMessage(payload).text
    expect(slack).toContain('⚠️ *Web* environment incident: staging.example.test')
    expect(slack).toContain('Environment incident, not counted: 4 of 4 tests failed')

    const email = buildAlertEmail(payload)
    expect(email.subject).toBe('⚠️ Web: environment incident, staging.example.test')
  })
})
