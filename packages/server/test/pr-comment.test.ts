import type { IngestRun, NormTest } from '@kinora/core'
import { makeTestKey } from '@kinora/core'
import { describe, expect, it } from 'vitest'
import { app } from '../src/app'
import { createApiKey, createUser, ingest } from './helpers'

// The regression summary is only returned when the client opts in with ?regression=1.
function ingestR(key: string, p: IngestRun) {
  return app.request('/api/v1/runs?regression=1', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify(p),
  })
}

const FILE = 'tests/checkout.spec.ts'
const TITLE_PATH = [FILE, 'completes a purchase']
const KEY = makeTestKey(FILE, TITLE_PATH, 'chromium')

function payload(opts: { status: NormTest['status'], branch: string, baseBranch?: string, startedAt: string, duration?: number }): IngestRun {
  const counts = { total: 1, expected: 0, unexpected: 0, flaky: 0, skipped: 0 }
  counts[opts.status] = 1
  return {
    project: { slug: 'web-app', name: 'web-app' },
    run: { startedAt: opts.startedAt, duration: 1000, counts, git: { branch: opts.branch, baseBranch: opts.baseBranch } },
    tests: [{
      testKey: KEY,
      title: 'completes a purchase',
      titlePath: TITLE_PATH,
      file: FILE,
      line: 1,
      column: 1,
      projectName: 'chromium',
      status: opts.status,
      ok: opts.status !== 'unexpected',
      duration: opts.duration ?? 1000,
      retries: 0,
      tags: [],
      annotations: [],
      errors: [],
      attachments: [],
    }],
  }
}

describe('ingest response regression (for PR comments)', () => {
  it('diffs vs the base branch and returns a durable run URL', async () => {
    const u = await createUser('pr@test.dev')
    const key = await createApiKey(u.id)

    // base branch run (test passes), then a PR run (same test now fails) with baseBranch = main
    await ingest(key, payload({ status: 'expected', branch: 'main', startedAt: '2026-07-18T10:00:00.000Z' }))
    const res = await ingestR(key, payload({ status: 'unexpected', branch: '5/merge', baseBranch: 'main', startedAt: '2026-07-18T11:00:00.000Z' }))
    const body = await res.json() as { runUrl?: string, regression?: { base: string, newlyFailing: { testKey: string }[] } }

    expect(body.runUrl).toContain('/projects/web-app/runs/')
    expect(body.regression?.base).toBe('base-branch')
    expect(body.regression?.newlyFailing).toHaveLength(1)
    expect(body.regression?.newlyFailing[0].testKey).toBe(KEY)
  })

  it('falls back to the same-branch previous run when there is no base branch', async () => {
    const u = await createUser('pr2@test.dev')
    const key = await createApiKey(u.id)

    await ingest(key, payload({ status: 'expected', branch: 'feature', startedAt: '2026-07-18T10:00:00.000Z' }))
    const res = await ingestR(key, payload({ status: 'unexpected', branch: 'feature', startedAt: '2026-07-18T11:00:00.000Z' }))
    const body = await res.json() as { regression?: { base: string, newlyFailing: unknown[] } }

    expect(body.regression?.base).toBe('previous-run')
    expect(body.regression?.newlyFailing).toHaveLength(1)
  })

  it('names the passing tests much slower than usual on the base branch', async () => {
    const key = await createApiKey((await createUser('pr-slow@test.dev')).id)
    for (const [i, duration] of [1000, 1100, 900, 1000, 1050, 950].entries())
      await ingest(key, payload({ status: 'expected', branch: 'main', duration, startedAt: `2026-07-18T0${i}:00:00.000Z` }))
    const pr = (duration: number, hour: number) => ingestR(key, payload({ status: 'expected', branch: '5/merge', baseBranch: 'main', duration, startedAt: `2026-07-18T${hour}:00:00.000Z` }))

    const slow = await (await pr(3000, 10)).json() as { regression?: { slower?: unknown[] } }
    expect(slow.regression?.slower).toEqual([{ testKey: KEY, title: 'completes a purchase', file: FILE, duration: 3000, usual: 1000 }])
    // Within the test's usual spread: not worth a line.
    const usual = await (await pr(1100, 11)).json() as { regression?: { slower?: unknown[] } }
    expect(usual.regression?.slower).toEqual([])
  })

  it('names no slower test until the baseline has enough passes to know its usual time', async () => {
    const key = await createApiKey((await createUser('pr-slow2@test.dev')).id)
    for (const hour of [1, 2, 3, 4])
      await ingest(key, payload({ status: 'expected', branch: 'main', startedAt: `2026-07-18T0${hour}:00:00.000Z` }))
    const res = await ingestR(key, payload({ status: 'expected', branch: '5/merge', baseBranch: 'main', duration: 9000, startedAt: '2026-07-18T10:00:00.000Z' }))
    expect((await res.json() as { regression?: { slower?: unknown[] } }).regression?.slower).toEqual([])
  })

  it('reports base=none on the first ever run', async () => {
    const u = await createUser('pr3@test.dev')
    const key = await createApiKey(u.id)
    const res = await ingestR(key, payload({ status: 'expected', branch: 'solo', startedAt: '2026-07-18T10:00:00.000Z' }))
    const body = await res.json() as { regression?: { base: string } }
    expect(body.regression?.base).toBe('none')
  })

  it('counts a PR-added failing test as newly failing (not silently "added")', async () => {
    const u = await createUser('pr4@test.dev')
    const key = await createApiKey(u.id)
    await ingest(key, payload({ status: 'expected', branch: 'main', startedAt: '2026-07-18T10:00:00.000Z' }))

    // Head PR keeps the existing test passing and adds a brand-new failing spec.
    const newKey = makeTestKey('tests/new.spec.ts', ['tests/new.spec.ts', 'new one'], 'chromium')
    const head = payload({ status: 'expected', branch: '6/merge', baseBranch: 'main', startedAt: '2026-07-18T11:00:00.000Z' })
    head.tests.push({
      testKey: newKey,
      title: 'new one',
      titlePath: ['tests/new.spec.ts', 'new one'],
      file: 'tests/new.spec.ts',
      line: 1,
      column: 1,
      projectName: 'chromium',
      status: 'unexpected',
      ok: false,
      duration: 1,
      retries: 0,
      tags: [],
      annotations: [],
      errors: [],
      attachments: [],
    })
    head.run.counts = { total: 2, expected: 1, unexpected: 1, flaky: 0, skipped: 0 }

    const res = await ingestR(key, head)
    const body = await res.json() as { regression?: { newlyFailing: { testKey: string }[] } }
    expect(body.regression?.newlyFailing.map(t => t.testKey)).toContain(newKey)
  })
})
