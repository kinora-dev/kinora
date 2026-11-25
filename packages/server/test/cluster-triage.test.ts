import type { NormTest } from '@kinora/core'
import { clusterState, isSnoozed, STOPPED_AFTER_RUNS } from '@kinora/core'
import { describe, expect, it } from 'vitest'
import { caller, createApiKey, createUser, ingest, runPayload } from './helpers'

const MINUTE = 60 * 1000

async function ingestRun(apiKey: string, status: NormTest['status'], minutesFromNow: number, slug = 'web-app', baseBranch?: string): Promise<void> {
  const payload = runPayload(slug, '@smoke', status)
  payload.run.startedAt = new Date(Date.now() + minutesFromNow * MINUTE).toISOString()
  if (baseBranch)
    payload.run.git = { branch: 'feature', baseBranch }
  if (status === 'unexpected')
    payload.tests[0].errors = [{ message: 'Error: expect(locator).toBeVisible() failed\nLocator: getByRole(\'button\', { name: \'Pay\' })' }]
  const res = await ingest(apiKey, payload)
  expect(res.status).toBe(201)
}

async function setup() {
  const u = await createUser()
  const apiKey = await createApiKey(u.id)
  return { u, apiKey, api: await caller(u) }
}

async function onlyCluster(api: Awaited<ReturnType<typeof caller>>) {
  const { clusters } = await api.dashboard.projectHistory({ projectId: 'web-app' })
  expect(clusters).toHaveLength(1)
  return clusters[0]
}

describe('failure cluster triage', () => {
  it('stores an assignee, a known issue and a note, and lists the cluster as mine', async () => {
    const { u, apiKey, api } = await setup()
    await ingestRun(apiKey, 'unexpected', -10)
    const { fingerprint } = await onlyCluster(api)

    let inbox = await api.dashboard.failureInbox()
    expect(inbox).toHaveLength(1)
    expect(inbox[0]).toMatchObject({ fingerprint, project: { id: 'web-app' } })
    expect(inbox[0].triage).toBeUndefined()

    const triage = await api.dashboard.triageCluster({
      projectId: 'web-app',
      fingerprint,
      assigneeId: u.id,
      issueUrl: 'https://github.com/acme/web/issues/12',
      note: 'payment iframe loads late',
    })
    expect(triage).toMatchObject({ status: 'open', assignee: { id: u.id, name: u.name }, issueUrl: 'https://github.com/acme/web/issues/12', note: 'payment iframe loads late' })

    // A partial change keeps the rest.
    await api.dashboard.triageCluster({ projectId: 'web-app', fingerprint, note: null })
    const c = await onlyCluster(api)
    expect(c.triage).toMatchObject({ assignee: { id: u.id }, issueUrl: 'https://github.com/acme/web/issues/12' })
    expect(c.triage?.note).toBeUndefined()

    inbox = await api.dashboard.failureInbox()
    expect(inbox[0].triage?.assignee?.id).toBe(u.id)
  })

  it('leaves the inbox once resolved, and comes back as a regression when it fails again', async () => {
    const { apiKey, api } = await setup()
    await ingestRun(apiKey, 'unexpected', -10)
    const { fingerprint } = await onlyCluster(api)

    await api.dashboard.triageCluster({ projectId: 'web-app', fingerprint, status: 'resolved' })
    expect(clusterState(await onlyCluster(api))).toBe('resolved')
    expect(await api.dashboard.failureInbox()).toHaveLength(0)

    // Passing after the resolution keeps it resolved, and so does a pull request without the fix;
    // a failure started after it elsewhere reopens it.
    await ingestRun(apiKey, 'expected', 1)
    expect(clusterState(await onlyCluster(api))).toBe('resolved')
    await ingestRun(apiKey, 'unexpected', 2, 'web-app', 'main')
    expect(clusterState(await onlyCluster(api))).toBe('resolved')
    await ingestRun(apiKey, 'unexpected', 3)
    expect(clusterState(await onlyCluster(api))).toBe('regressed')
    expect((await api.dashboard.failureInbox()).map(c => clusterState(c))).toEqual(['regressed'])
  })

  it('reads a cluster whose tests keep passing as stopped', async () => {
    const { apiKey, api } = await setup()
    await ingestRun(apiKey, 'unexpected', -10)
    for (let i = 1; i < STOPPED_AFTER_RUNS; i++)
      await ingestRun(apiKey, 'expected', -10 + i)
    expect(await onlyCluster(api)).toMatchObject({ quietRuns: STOPPED_AFTER_RUNS - 1 })
    expect(clusterState(await onlyCluster(api))).toBe('failing')

    await ingestRun(apiKey, 'expected', -1)
    expect(clusterState(await onlyCluster(api))).toBe('stopped')
  })

  it('snoozes a cluster until it fails again', async () => {
    const { apiKey, api } = await setup()
    await ingestRun(apiKey, 'unexpected', -10)
    const { fingerprint } = await onlyCluster(api)

    await api.dashboard.triageCluster({ projectId: 'web-app', fingerprint, snooze: 'recur' })
    expect(isSnoozed(await onlyCluster(api))).toBe(true)

    await ingestRun(apiKey, 'unexpected', 1)
    expect(isSnoozed(await onlyCluster(api))).toBe(false)

    // Resolving lifts a snooze, and a resolved cluster can't be snoozed.
    await api.dashboard.triageCluster({ projectId: 'web-app', fingerprint, snooze: { until: new Date(Date.now() + 60 * MINUTE).toISOString() } })
    expect(isSnoozed(await onlyCluster(api))).toBe(true)
    await api.dashboard.triageCluster({ projectId: 'web-app', fingerprint, status: 'resolved' })
    expect((await onlyCluster(api)).triage?.snoozedAt).toBeUndefined()
    await expect(api.dashboard.triageCluster({ projectId: 'web-app', fingerprint, snooze: 'recur' })).rejects.toThrow(/Only an open cluster/)
  })

  it('only assigns members of the workspace, and only on its own projects', async () => {
    const { apiKey, api } = await setup()
    await ingestRun(apiKey, 'unexpected', -10)
    const { fingerprint } = await onlyCluster(api)

    const stranger = await createUser('stranger@test.dev')
    await expect(api.dashboard.triageCluster({ projectId: 'web-app', fingerprint, assigneeId: stranger.id })).rejects.toThrow(/not a member/)

    const strangerApi = await caller(stranger)
    await expect(strangerApi.dashboard.triageCluster({ projectId: 'web-app', fingerprint, status: 'ignored' })).rejects.toThrow(/Project not found/)
    expect(await strangerApi.dashboard.failureInbox()).toHaveLength(0)
  })
})
