import type { NormTest } from '@kinora/core'
import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/app'
import { purgeArtifactsBefore, purgeScope } from '../src/billing/retention'
import { storageBytes } from '../src/billing/usage'
import { db } from '../src/db'
import { artifact, run, testQuarantine } from '../src/db/schemas/index'
import { env } from '../src/lib/env'
import { releaseExpiredPins } from '../src/reports/quarantine'
import { caller, createApiKey, createUser, ingest, ownedOrgId, resetDb, runPayload } from './helpers'

beforeEach(resetDb)

const DAY = 24 * 60 * 60 * 1000

async function blobExists(key: string): Promise<boolean> {
  return access(resolve(env.STORAGE_DIR, key)).then(() => true, () => false)
}

async function ingestRun(apiKey: string, status: NormTest['status'], daysAgo: number, sha?: string): Promise<string> {
  const payload = runPayload('web-app', '@smoke', status)
  payload.run.startedAt = new Date(Date.now() - daysAgo * DAY).toISOString()
  if (sha)
    payload.run.git = { sha }
  const res = await ingest(apiKey, payload)
  return ((await res.json()) as { runId: string }).runId
}

async function uploadTrace(apiKey: string, runId: string): Promise<void> {
  const form = new FormData()
  form.set('file', new File([new Uint8Array([0x50, 0x4B, 0x03, 0x04])], 'trace.zip'))
  form.set('name', 'trace')
  form.set('testKey', runPayload().tests[0].testKey)
  const res = await app.request(`/api/v1/runs/${runId}/artifacts`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form })
  expect(res.status).toBe(201)
}

async function traceKeyOf(runId: string): Promise<string> {
  const a = await db.query.artifact.findFirst({ where: eq(artifact.runId, runId) })
  return a!.storageKey
}

const testKey = runPayload().tests[0].testKey

describe('quarantine pinned trace', () => {
  it('pins the trace of the latest failure when a test is quarantined', async () => {
    const u = await createUser()
    const apiKey = await createApiKey(u.id)
    const older = await ingestRun(apiKey, 'unexpected', 3)
    const latest = await ingestRun(apiKey, 'flaky', 2, 'abc1234def')
    const passing = await ingestRun(apiKey, 'expected', 1)
    for (const id of [older, latest, passing])
      await uploadTrace(apiKey, id)

    const api = await caller(u)
    await api.dashboard.quarantine({ projectId: 'web-app', testKey })

    const [q] = await api.dashboard.quarantines({ projectId: 'web-app' })
    expect(q.pinnedTrace).toMatchObject({ runId: latest, status: 'flaky', sha: 'abc1234def', size: 4 })
    expect(q.pinnedTrace?.url).toContain(await traceKeyOf(latest))

    // Updating the reason keeps the first pin.
    await ingestRun(apiKey, 'unexpected', 0).then(id => uploadTrace(apiKey, id))
    await api.dashboard.quarantine({ projectId: 'web-app', testKey, reason: 'checkout race' })
    expect((await api.dashboard.quarantines({ projectId: 'web-app' }))[0].pinnedTrace?.runId).toBe(latest)
  })

  it('pins the first failing trace uploaded after the test was quarantined', async () => {
    const u = await createUser()
    const apiKey = await createApiKey(u.id)
    await ingestRun(apiKey, 'expected', 2)
    const api = await caller(u)
    await api.dashboard.quarantine({ projectId: 'web-app', testKey })
    expect((await api.dashboard.quarantines({ projectId: 'web-app' }))[0].pinnedTrace).toBeUndefined()

    await uploadTrace(apiKey, await ingestRun(apiKey, 'expected', 1))
    expect((await api.dashboard.quarantines({ projectId: 'web-app' }))[0].pinnedTrace).toBeUndefined()

    const failing = await ingestRun(apiKey, 'unexpected', 0)
    await uploadTrace(apiKey, failing)
    expect((await api.dashboard.quarantines({ projectId: 'web-app' }))[0].pinnedTrace?.runId).toBe(failing)
  })

  it('survives retention while quarantined and is deleted once unquarantined', async () => {
    const u = await createUser()
    const apiKey = await createApiKey(u.id)
    const pinned = await ingestRun(apiKey, 'unexpected', 40)
    const other = await ingestRun(apiKey, 'unexpected', 41)
    await uploadTrace(apiKey, pinned)
    await uploadTrace(apiKey, other)
    const pinnedKey = await traceKeyOf(pinned)
    const otherKey = await traceKeyOf(other)
    const api = await caller(u)
    await api.dashboard.quarantine({ projectId: 'web-app', testKey })

    await purgeArtifactsBefore(new Date(Date.now() - 30 * DAY))
    await purgeScope(new Date(Date.now() - 30 * DAY), {})

    expect(await db.query.run.findFirst({ where: eq(run.id, pinned) })).toBeUndefined()
    expect(await blobExists(otherKey)).toBe(false)
    expect(await blobExists(pinnedKey)).toBe(true)
    expect((await api.dashboard.quarantines({ projectId: 'web-app' }))[0].pinnedTrace?.url).toContain(pinnedKey)
    // No artifact row is left, yet the blob still counts against storage.
    expect(await storageBytes(await ownedOrgId(u.id))).toBe(4)

    await api.dashboard.unquarantine({ projectId: 'web-app', testKey })
    expect(await blobExists(pinnedKey)).toBe(false)
  })

  it('releases the trace of an expired quarantine', async () => {
    const u = await createUser()
    const apiKey = await createApiKey(u.id)
    const failing = await ingestRun(apiKey, 'unexpected', 40)
    await uploadTrace(apiKey, failing)
    const key = await traceKeyOf(failing)
    const api = await caller(u)
    await api.dashboard.quarantine({ projectId: 'web-app', testKey })
    await purgeScope(new Date(Date.now() - 30 * DAY), {})

    await db.update(testQuarantine).set({ expiresAt: new Date(Date.now() - 1000) })
    expect(await releaseExpiredPins()).toBe(1)
    expect(await blobExists(key)).toBe(false)
    expect((await db.query.testQuarantine.findFirst())?.pinnedTraceKey).toBeNull()
  })
})

describe('run workers', () => {
  it('stores the worker count and returns it on the run report', async () => {
    const u = await createUser()
    const payload = runPayload()
    payload.run.workers = 4
    const { runId } = (await (await ingest(await createApiKey(u.id), payload)).json()) as { runId: string }
    const report = await (await caller(u)).dashboard.run({ projectId: 'web-app', runId })
    expect(report.meta.workers).toBe(4)
  })
})
