import type { IngestRun, NormTest } from '@kinora/core'
import { makeTestKey } from '@kinora/core'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { app } from '../src/app'
import { db } from '../src/db'
import { run } from '../src/db/schemas/index'
import { caller, createApiKey, createUser, ingest } from './helpers'

function suite(statuses: NormTest['status'][], extra: Partial<IngestRun['run']> = {}): IngestRun {
  const file = 'tests/checkout.spec.ts'
  const tests: NormTest[] = statuses.map((status, i) => {
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
      errors: status === 'unexpected' ? [{ message: 'Error: expect(locator).toBeVisible() failed' }] : [],
      attachments: [],
    }
  })
  const counts = { total: tests.length, expected: 0, unexpected: 0, flaky: 0, skipped: 0 }
  for (const s of statuses)
    counts[s]++
  return {
    project: { slug: 'web-app', name: 'web-app' },
    run: { startedAt: new Date().toISOString(), duration: 40, counts, git: { branch: 'main' }, ...extra },
    tests,
  }
}

const later = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()

async function storedInterruption(runId: string) {
  return (await db.query.run.findFirst({ where: eq(run.id, runId), columns: { interruption: true } }))?.interruption
}

describe('interrupted runs', () => {
  it('stores how the run was cut short and shows it on the run', async () => {
    const user = await createUser()
    const key = await createApiKey(user.id)
    const res = await ingest(key, suite(['expected', 'unexpected'], { interruption: 'timedout' }))
    expect(res.status).toBe(201)
    const { runId } = await res.json() as { runId: string }

    expect(await storedInterruption(runId)).toBe('timedout')
    const trpc = await caller(user)
    expect((await trpc.dashboard.run({ projectId: 'web-app', runId })).meta.interruption).toBe('timedout')
    const history = await trpc.dashboard.projectHistory({ projectId: 'web-app' })
    expect(history.project?.runs[0].interruption).toBe('timedout')
  })

  it('drops an interruption it does not know instead of rejecting the run', async () => {
    const key = await createApiKey((await createUser()).id)
    const payload = suite(['expected'])
    const res = await ingest(key, { ...payload, run: { ...payload.run, interruption: 'crashed' } } as unknown as IngestRun)
    expect(res.status).toBe(201)
    const { runId } = await res.json() as { runId: string }
    expect(await storedInterruption(runId)).toBeNull()
  })

  it('keeps a cut-short run out of the regression baseline', async () => {
    const key = await createApiKey((await createUser()).id)
    await ingest(key, suite(['expected', 'expected', 'expected'], { startedAt: later(0) }))
    await ingest(key, suite(['unexpected'], { startedAt: later(1), interruption: 'interrupted' }))

    // Compared with the full run before, not with the cancelled one: nothing "fixed".
    const res = await app.request('/api/v1/runs?regression=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify(suite(['expected', 'expected', 'expected'], { startedAt: later(2) })),
    })
    const body = await res.json() as { regression?: { base: string, fixed: number } }
    expect(body.regression).toMatchObject({ base: 'previous-run', fixed: 0 })
  })

  it('marks a grouped run cut short when one of its shards was, until a re-run of that shard', async () => {
    const key = await createApiKey((await createUser()).id)
    const shard = (current: number, extra: Partial<IngestRun['run']> = {}) => suite(['expected'], { groupKey: 'ci-7', shard: { current, total: 2 }, ...extra })

    const { runId } = await (await ingest(key, shard(1, { interruption: 'timedout' }))).json() as { runId: string }
    await ingest(key, shard(2, { interruption: 'interrupted' }))
    expect(await storedInterruption(runId)).toBe('interrupted')

    await ingest(key, shard(2, { attempt: 2 }))
    expect(await storedInterruption(runId)).toBe('timedout')
    await ingest(key, shard(1, { attempt: 2 }))
    expect(await storedInterruption(runId)).toBeNull()
  })
})
