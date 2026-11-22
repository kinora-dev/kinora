import type { NormTest } from '@kinora/core'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyRun } from '../src/alerts/notify'
import { db } from '../src/db'
import { alertChannel, project, run, slackIntegration, testQuarantine, test as testRow } from '../src/db/schemas/index'
import { createUser, ownedOrgId, resetDb } from './helpers'

const DAY = 24 * 60 * 60 * 1000

beforeEach(resetDb)
afterEach(() => vi.unstubAllGlobals())

function stubFetchOk() {
  const mock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', mock)
  return mock
}

function normTest(testKey: string, status: NormTest['status']): NormTest {
  return {
    testKey,
    title: testKey,
    titlePath: ['f.ts', testKey],
    file: 'f.ts',
    line: 1,
    column: 1,
    projectName: 'chromium',
    status,
    ok: status !== 'unexpected',
    duration: 0,
    retries: 0,
    tags: [],
    annotations: [],
    errors: [],
    attachments: [],
  }
}

async function seedProject(userId: string): Promise<string> {
  const id = randomUUID()
  const organizationId = await ownedOrgId(userId)
  await db.insert(project).values({ id, organizationId, slug: `s-${id}`, name: 'web-app' })
  return id
}

async function seedPrevRun(projectId: string, tests: NormTest[], startedAt: Date): Promise<void> {
  const runId = randomUUID()
  await db.insert(run).values({
    id: runId,
    projectId,
    startedAt,
    duration: 0,
    counts: { total: tests.length, expected: tests.length, unexpected: 0, flaky: 0, skipped: 0 },
  })
  if (tests.length)
    await db.insert(testRow).values(tests.map(t => ({ id: randomUUID(), runId, projectId, ...t })))
}

// Targets use RFC 5737 documentation IPs: the SSRF guard treats them as public (skips DNS) and they never route.
function setChannel(projectId: string, policy: 'always' | 'on-failure' | 'on-regression', enabled = true) {
  return db.insert(slackIntegration).values({ projectId, webhookUrl: 'https://198.51.100.10/services/x', policy, enabled })
}

const WEBHOOK_URL = 'https://203.0.113.10/hook'
function setWebhookChannel(projectId: string, policy: 'always' | 'on-failure' | 'on-regression', enabled = true) {
  return db.insert(alertChannel).values({ id: randomUUID(), projectId, kind: 'webhook', target: WEBHOOK_URL, policy, enabled })
}

const PASS = { total: 1, expected: 1, unexpected: 0, flaky: 0, skipped: 0 }
const FAIL = { total: 1, expected: 0, unexpected: 1, flaky: 0, skipped: 0 }

describe('notifyRun', () => {
  it('fires on a newly failing test with on-regression policy', async () => {
    const user = await createUser()
    const projectId = await seedProject(user.id)
    await setChannel(projectId, 'on-regression')
    await seedPrevRun(projectId, [normTest('t1', 'expected')], new Date(Date.now() - DAY))

    const fetchMock = stubFetchOk()
    await notifyRun({ organizationId: await ownedOrgId(user.id), projectId, runId: 'r2', startedAt: new Date(), counts: FAIL, tests: [normTest('t1', 'unexpected')] })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body.text).toContain('Newly failing')
    expect(body.text).toContain('t1')
  })

  it('includes code owners in regression alerts', async () => {
    const user = await createUser()
    const projectId = await seedProject(user.id)
    await db.update(project).set({ codeownersText: '*.ts @frontend' }).where(eq(project.id, projectId))
    await setChannel(projectId, 'on-regression')
    await seedPrevRun(projectId, [normTest('t1', 'expected')], new Date(Date.now() - DAY))

    const fetchMock = stubFetchOk()
    await notifyRun({ organizationId: await ownedOrgId(user.id), projectId, runId: 'r2', startedAt: new Date(), counts: FAIL, tests: [normTest('t1', 'unexpected')] })

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body.text).toContain('t1 (@frontend)')
  })

  it('does not fire when there is no regression (on-regression)', async () => {
    const user = await createUser()
    const projectId = await seedProject(user.id)
    await setChannel(projectId, 'on-regression')
    await seedPrevRun(projectId, [normTest('t1', 'expected')], new Date(Date.now() - DAY))

    const fetchMock = stubFetchOk()
    await notifyRun({ organizationId: await ownedOrgId(user.id), projectId, runId: 'r2', startedAt: new Date(), counts: PASS, tests: [normTest('t1', 'expected')] })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fires every run with always policy', async () => {
    const user = await createUser()
    const projectId = await seedProject(user.id)
    await setChannel(projectId, 'always')

    const fetchMock = stubFetchOk()
    await notifyRun({ organizationId: await ownedOrgId(user.id), projectId, runId: 'r1', startedAt: new Date(), counts: PASS, tests: [normTest('t1', 'expected')] })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stays quiet on a cancelled run but still alerts on one that timed out or bailed', async () => {
    const user = await createUser()
    const projectId = await seedProject(user.id)
    await setChannel(projectId, 'always')
    const organizationId = await ownedOrgId(user.id)

    const fetchMock = stubFetchOk()
    await notifyRun({ organizationId, projectId, runId: 'r1', startedAt: new Date(), counts: FAIL, tests: [normTest('t1', 'unexpected')], interruption: 'interrupted' })
    expect(fetchMock).not.toHaveBeenCalled()

    await notifyRun({ organizationId, projectId, runId: 'r2', startedAt: new Date(), counts: FAIL, tests: [normTest('t1', 'unexpected')], interruption: 'timedout' })
    await notifyRun({ organizationId, projectId, runId: 'r3', startedAt: new Date(), counts: FAIL, tests: [normTest('t1', 'unexpected')], interruption: 'bailed' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not fire when the channel is disabled', async () => {
    const user = await createUser()
    const projectId = await seedProject(user.id)
    await setChannel(projectId, 'always', false)

    const fetchMock = stubFetchOk()
    await notifyRun({ organizationId: await ownedOrgId(user.id), projectId, runId: 'r1', startedAt: new Date(), counts: PASS, tests: [normTest('t1', 'expected')] })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not fire on failure when the only failing test is quarantined', async () => {
    const user = await createUser()
    const projectId = await seedProject(user.id)
    await setChannel(projectId, 'on-failure')
    await db.insert(testQuarantine).values({ id: randomUUID(), projectId, testKey: 't1' })

    const fetchMock = stubFetchOk()
    await notifyRun({ organizationId: await ownedOrgId(user.id), projectId, runId: 'r1', startedAt: new Date(), counts: FAIL, tests: [normTest('t1', 'unexpected')] })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('notifyRun webhook channel', () => {
  it('posts the alert payload to the webhook target', async () => {
    const user = await createUser()
    const projectId = await seedProject(user.id)
    await db.update(project).set({ codeownersText: '*.ts @frontend' }).where(eq(project.id, projectId))
    await setWebhookChannel(projectId, 'on-regression')
    await seedPrevRun(projectId, [normTest('t1', 'expected')], new Date(Date.now() - DAY))

    const fetchMock = stubFetchOk()
    await notifyRun({ organizationId: await ownedOrgId(user.id), projectId, runId: 'r1', startedAt: new Date(), counts: FAIL, tests: [normTest('t1', 'unexpected')] })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(WEBHOOK_URL)
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body.counts.unexpected).toBe(1)
    expect(body.codeOwners).toEqual({ t1: ['@frontend'] })
    expect(body.runUrl).toContain('/projects/')
  })

  it('respects the per-channel policy (on-regression, no regression -> no post)', async () => {
    const user = await createUser()
    const projectId = await seedProject(user.id)
    await setWebhookChannel(projectId, 'on-regression')
    await seedPrevRun(projectId, [normTest('t1', 'expected')], new Date(Date.now() - DAY))

    const fetchMock = stubFetchOk()
    await notifyRun({ organizationId: await ownedOrgId(user.id), projectId, runId: 'r2', startedAt: new Date(), counts: PASS, tests: [normTest('t1', 'expected')] })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
