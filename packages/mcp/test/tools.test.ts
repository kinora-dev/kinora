import type { FailureCause, NormTest, RunReport, TestHistory, TestPoint } from '@kinora/core'
import { fingerprintError, IngestError, SCHEMA_VERSION } from '@kinora/core'
import { describe, expect, it, vi } from 'vitest'
import { registerTools } from '../src/tools'

type Handler = (args: any) => Promise<{ content: { text: string }[], isError?: boolean }> | { content: { text: string }[], isError?: boolean }

function harness(client: any) {
  const handlers = new Map<string, Handler>()
  const server = { registerTool: (name: string, _cfg: unknown, h: Handler) => handlers.set(name, h) }
  registerTools(server as any, client)
  return async (name: string, args: any = {}) => {
    const res = await handlers.get(name)!(args)
    return { isError: res.isError ?? false, data: res.isError ? res.content[0].text : JSON.parse(res.content[0].text) }
  }
}

function failing(over: Partial<NormTest> = {}): NormTest {
  return {
    testKey: 'k1',
    title: 'purchase',
    titlePath: [],
    file: 'a.ts',
    line: 1,
    column: 1,
    projectName: 'chromium',
    status: 'unexpected',
    ok: false,
    duration: 1,
    retries: 0,
    tags: [],
    annotations: [],
    errors: [{ message: 'boom' }],
    attachments: [{ name: 'trace', contentType: 'application/zip', hasBody: true, url: 'https://x/t.zip' }],
    ...over,
  }
}

function report(tests: NormTest[]): RunReport {
  return { schemaVersion: SCHEMA_VERSION, runId: 'r1', projectId: 'p', startedAt: '2026-07-14T00:00:00.000Z', duration: 1, counts: { total: tests.length, expected: 0, unexpected: 0, flaky: 0, skipped: 0 }, meta: {}, tests }
}

function hist(over: Partial<TestHistory>): TestHistory {
  return { testKey: 'k', title: 't', titlePath: [], file: 'f', projectName: 'c', points: [], runs: 1, passed: 1, failed: 0, flaky: 0, skipped: 0, executed: 1, flakyRate: 0, failRate: 0, passRate: 1, recentFlakyRate: 0, recentFailRate: 0, newlyFlaky: false, newlyBroken: false, lastStatus: 'expected', ...over }
}

describe('list_failures', () => {
  it('formats the failures returned by the client', async () => {
    const call = harness({ getFailures: vi.fn().mockResolvedValue({ runId: 'r1', startedAt: 's', counts: {}, failures: [failing()] }) })
    const { data } = await call('list_failures', { project: 'p' })
    expect(data.failures[0].location).toBe('a.ts:1:1')
    expect(data.failures[0].traceUrl).toBe('https://x/t.zip')
  })

  it('flags a quarantined test with the reason the team gave', async () => {
    const getQuarantines = vi.fn().mockResolvedValue([{ testKey: 'k1', reason: 'flaky on webkit', expiresAt: '2026-08-01T00:00:00.000Z' }])
    const call = harness({ getFailures: vi.fn().mockResolvedValue({ runId: 'r1', startedAt: 's', counts: {}, failures: [failing(), failing({ testKey: 'k2' })] }), getQuarantines })
    const { data } = await call('list_failures', { project: 'p' })
    expect(getQuarantines).toHaveBeenCalledWith('p')
    expect(data.failures[0].quarantined).toEqual({ reason: 'flaky on webkit', expiresAt: '2026-08-01T00:00:00.000Z' })
    expect(data.failures[1]).not.toHaveProperty('quarantined')
  })

  it('surfaces the server error message', async () => {
    const call = harness({ getFailures: vi.fn().mockRejectedValue(new IngestError(404, 'Project not found')) })
    const { isError, data } = await call('list_failures', { project: 'nope' })
    expect(isError).toBe(true)
    expect(data).toContain('Project not found')
  })
})

describe('get_run', () => {
  it('counts flaky tests (ok=true) as failures', async () => {
    const flaky = failing({ testKey: 'fk', status: 'flaky', ok: true })
    const passed = failing({ testKey: 'ok', status: 'expected', ok: true, errors: [], attachments: [] })
    const call = harness({ getRun: vi.fn().mockResolvedValue(report([flaky, passed])), getFailures: vi.fn().mockRejectedValue(new IngestError(500, 'down')) })
    const { data } = await call('get_run', { project: 'p' })
    expect(data.failures.map((f: any) => f.testKey)).toEqual(['fk'])
    expect(data.tests).toHaveLength(2)
  })

  it('gives failures their cause, read for the run it resolved', async () => {
    const getFailures = vi.fn().mockResolvedValue({ runId: 'r1', startedAt: 's', counts: {}, failures: [], causes: [cause({ triage: { status: 'open', issueUrl: 'https://github.com/acme/web/issues/9', updatedAt: 's' } })] })
    const call = harness({ getRun: vi.fn().mockResolvedValue(report([failing()])), getFailures })
    const { data } = await call('get_run', { project: 'p' })
    expect(getFailures).toHaveBeenCalledWith('p', 'r1')
    expect(data.failures[0].cause).toMatchObject({ state: 'failing', issueUrl: 'https://github.com/acme/web/issues/9' })
  })
})

describe('list_projects', () => {
  it('keeps what picks a project, not per-tag counts or report paths', async () => {
    const latestRun = { runId: 'r1', projectId: 'p', startedAt: 's', duration: 5, counts: { total: 1, expected: 1, unexpected: 0, flaky: 0, skipped: 0 }, git: { branch: 'main', sha: 'abc' }, reportPath: 'reports/p/r1.json', countsByTag: { '@smoke': { total: 1, expected: 1, unexpected: 0, flaky: 0, skipped: 0 } }, incident: { rule: 'host-unreachable' as const, reason: 'app down' } }
    const call = harness({ listProjects: vi.fn().mockResolvedValue([{ id: 'p', name: 'P', latestRun }, { id: 'q', name: 'Q', latestRun: null }]) })
    const { data } = await call('list_projects')
    expect(data.projects).toEqual([
      { id: 'p', name: 'P', latestRun: { runId: 'r1', startedAt: 's', duration: 5, counts: latestRun.counts, branch: 'main', sha: 'abc', incident: 'app down' } },
      { id: 'q', name: 'Q', latestRun: null },
    ])
  })
})

describe('test_history', () => {
  it('with no testKey/query returns only flaky and broken tests, with the reason', async () => {
    const at = (status: TestPoint['status'], sha?: string): TestPoint => ({ runId: 'r', startedAt: '2026-01-01T00:00:00Z', status, duration: 1, retries: 0, ...(sha && { sha }) })
    const histories = [
      hist({ testKey: 'stable', points: [at('expected'), at('expected')] }),
      hist({ testKey: 'flaky', points: [at('expected', 'abc1234'), at('unexpected', 'abc1234'), at('expected', 'def5678')] }),
    ]
    const call = harness({ getHistory: vi.fn().mockResolvedValue(histories) })
    const { data } = await call('test_history', { project: 'p' })
    expect(data.histories.map((h: any) => h.testKey)).toEqual(['flaky'])
    expect(data.histories[0]).toMatchObject({ health: 'flaky', healthReason: 'Passed and failed on the same commit abc1234.' })
    expect(data.histories[0].recentPoints[0].sha).toBe('abc1234')
  })

  it('with query filters by title substring', async () => {
    const histories = [hist({ testKey: 'a', title: 'login flow' }), hist({ testKey: 'b', title: 'checkout' })]
    const call = harness({ getHistory: vi.fn().mockResolvedValue(histories) })
    const { data } = await call('test_history', { project: 'p', query: 'CHECK' })
    expect(data.histories.map((h: any) => h.testKey)).toEqual(['b'])
  })

  it('with testKey passes it through to the client', async () => {
    const getHistory = vi.fn().mockResolvedValue([hist({ testKey: 'k1' })])
    const call = harness({ getHistory })
    await call('test_history', { project: 'p', testKey: 'k1' })
    expect(getHistory).toHaveBeenCalledWith('p', 'k1')
  })

  it('keeps 20 points for one test and 5 per test in a list, and says when a key matches nothing', async () => {
    const points = Array.from({ length: 30 }, (_, i): TestPoint => ({ runId: `r${i}`, startedAt: 's', status: i % 2 ? 'unexpected' : 'expected', duration: 1, retries: 0 }))
    const call = harness({ getHistory: vi.fn().mockResolvedValue([hist({ testKey: 'k1', title: 'login', points })]) })
    expect((await call('test_history', { project: 'p', testKey: 'k1' })).data.histories[0].recentPoints).toHaveLength(20)
    expect((await call('test_history', { project: 'p', query: 'login' })).data.histories[0].recentPoints).toHaveLength(5)

    const empty = harness({ getHistory: vi.fn().mockResolvedValue([]) })
    expect((await empty('test_history', { project: 'p', testKey: 'nope' })).data.note).toContain('No test with key nope')
  })
})

describe('get_trace', () => {
  it('returns the trace url for a test', async () => {
    const call = harness({ getRun: vi.fn().mockResolvedValue(report([failing()])) })
    const { data } = await call('get_trace', { project: 'p', testKey: 'k1' })
    expect(data.traceUrl).toBe('https://x/t.zip')
  })

  it('errors when the test is missing', async () => {
    const call = harness({ getRun: vi.fn().mockResolvedValue(report([failing()])) })
    const { isError } = await call('get_trace', { project: 'p', testKey: 'ghost' })
    expect(isError).toBe(true)
  })

  it('errors when no trace is attached', async () => {
    const call = harness({ getRun: vi.fn().mockResolvedValue(report([failing({ attachments: [] })])) })
    const { isError, data } = await call('get_trace', { project: 'p', testKey: 'k1' })
    expect(isError).toBe(true)
    expect(data).toContain('no trace')
  })
})

describe('component_health', () => {
  const pt = (runId: string, status: TestPoint['status']): TestPoint => ({ runId, startedAt: `2026-01-0${runId.slice(1)}T00:00:00Z`, status, duration: 1, retries: 0 })
  const histories = [
    hist({ testKey: 'a', title: 'primary', stories: ['components/Button/Primary'], points: [pt('r1', 'expected'), pt('r2', 'expected')], lastStatus: 'expected' }),
    hist({ testKey: 'b', title: 'disabled', stories: ['components/Button/Disabled'], points: [pt('r1', 'flaky'), pt('r2', 'expected')], lastStatus: 'expected' }),
    hist({ testKey: 'c', title: 'dialog', stories: ['components/Dialog/Default'], points: [pt('r1', 'expected'), pt('r2', 'unexpected')], lastStatus: 'unexpected' }),
    hist({ testKey: 'e2e', title: 'checkout' }),
  ]

  it('groups stories by component with their window health and tests', async () => {
    const call = harness({ getHistory: vi.fn().mockResolvedValue(histories) })
    const { data } = await call('component_health', { project: 'p' })
    expect(data.components.map((c: any) => c.name)).toEqual(['Button', 'Dialog'])
    const disabled = data.components[0].stories.find((s: any) => s.name === 'Disabled')
    expect(disabled).toMatchObject({ id: 'components/Button/Disabled', lastStatus: 'expected', unstable: true, health: 'flaky', flakyRate: 0.5, recentStatuses: ['flaky', 'expected'] })
    expect(disabled.tests).toEqual([{ testKey: 'b', title: 'disabled', file: 'f', lastStatus: 'expected' }])
    expect(data.note).toBeUndefined()
  })

  it('filters by component and by instability', async () => {
    const call = harness({ getHistory: vi.fn().mockResolvedValue(histories) })
    expect((await call('component_health', { project: 'p', component: 'dialog' })).data.components.map((c: any) => c.name)).toEqual(['Dialog'])
    const unstable = (await call('component_health', { project: 'p', unstableOnly: true })).data.components
    expect(unstable.flatMap((c: any) => c.stories.map((s: any) => s.id))).toEqual(['components/Button/Disabled', 'components/Dialog/Default'])
    const broken = (await call('component_health', { project: 'p', health: 'broken' })).data.components
    expect(broken.flatMap((c: any) => c.stories.map((s: any) => [s.id, s.health]))).toEqual([['components/Dialog/Default', 'broken']])
  })

  it('returns the a11y violations of a story, most severe first', async () => {
    const report = {
      status: 'warning' as const,
      violations: [
        { id: 'region', impact: 'moderate' as const, help: 'Content should be in landmarks', nodes: ['#x'], nodeCount: 1 },
        { id: 'button-name', impact: 'critical' as const, help: 'Buttons must have discernible text', nodes: ['#b'], nodeCount: 1 },
      ],
    }
    const withA11y = [hist({ testKey: 'a', stories: ['components/Button/Icon'], points: [pt('r1', 'expected')], a11y: report })]
    const call = harness({ getHistory: vi.fn().mockResolvedValue(withA11y) })
    const story = (await call('component_health', { project: 'p' })).data.components[0].stories[0]
    expect(story.a11y.status).toBe('warning')
    expect(story.a11y.violations.map((v: any) => v.id)).toEqual(['button-name', 'region'])
  })

  it('explains an empty result on a project without stories', async () => {
    const call = harness({ getHistory: vi.fn().mockResolvedValue([hist({ testKey: 'e2e' })]) })
    const { data } = await call('component_health', { project: 'p' })
    expect(data.components).toEqual([])
    expect(data.note).toMatch(/@kinora\/reporter\/ct/)
  })

  it('surfaces server errors', async () => {
    const call = harness({ getHistory: vi.fn().mockRejectedValue(new IngestError(404, 'Project not found')) })
    expect(await call('component_health', { project: 'nope' })).toEqual({ isError: true, data: 'kinora: Project not found' })
  })
})

describe('test_history stories', () => {
  it('lists the stories a component test mounts', async () => {
    const call = harness({ getHistory: vi.fn().mockResolvedValue([hist({ testKey: 'k', stories: ['Button/Primary'] }), hist({ testKey: 'e2e' })]) })
    const { data } = await call('test_history', { project: 'p', query: 't' })
    expect(data.histories[0].stories).toEqual(['Button/Primary'])
    expect(data.histories[1]).not.toHaveProperty('stories')
  })
})

function cause(over: Partial<FailureCause> = {}): FailureCause {
  return {
    fingerprint: fingerprintError({ message: 'boom' }).fingerprint,
    title: 'boom',
    sample: 'boom',
    count: 3,
    tests: 2,
    testKeys: ['k1', 'k2'],
    files: ['a.ts'],
    firstSeen: '2026-07-01T00:00:00.000Z',
    lastSeen: '2026-07-14T00:00:00.000Z',
    lastRunId: 'r1',
    project: { id: 'p', name: 'P' },
    state: 'failing',
    snoozed: false,
    url: 'https://app.kinora.dev/projects/p/tests?cluster=x',
    ...over,
  }
}

describe('failure causes', () => {
  it('gives a failure the cause the team already tracks', async () => {
    const tracked = cause({ triage: { status: 'open', assignee: { id: 'u1', name: 'Ada' }, issueUrl: 'https://github.com/acme/web/issues/9', note: 'iframe race', updatedAt: 's' } })
    const call = harness({ getFailures: vi.fn().mockResolvedValue({ runId: 'r1', startedAt: 's', counts: {}, failures: [failing(), failing({ testKey: 'k3', errors: [{ message: 'other' }] })], causes: [tracked] }) })
    const { data } = await call('list_failures', { project: 'p' })
    expect(data.failures[0].cause).toEqual({
      fingerprint: tracked.fingerprint,
      state: 'failing',
      tests: 2,
      assignee: 'Ada',
      issueUrl: 'https://github.com/acme/web/issues/9',
      note: 'iframe race',
      url: tracked.url,
    })
    expect(data.failures[1].cause).toBeUndefined()
  })

  it('lists open causes, leaving out the snoozed unless asked, filtered by state', async () => {
    const getOpenCauses = vi.fn().mockResolvedValue([
      cause({ fingerprint: 'a', state: 'regressed' }),
      cause({ fingerprint: 'b' }),
      cause({ fingerprint: 'c', snoozed: true }),
    ])
    const call = harness({ getOpenCauses })
    expect((await call('list_open_failures', { project: 'p' })).data.causes.map((c: { fingerprint: string }) => c.fingerprint)).toEqual(['a', 'b'])
    expect(getOpenCauses).toHaveBeenCalledWith('p')
    expect((await call('list_open_failures', { includeSnoozed: true })).data.causes).toHaveLength(3)
    const { data } = await call('list_open_failures', { state: 'regressed' })
    expect(data.causes).toEqual([expect.objectContaining({ fingerprint: 'a', state: 'regressed', error: 'boom', testKeys: ['k1', 'k2'], occurrences: 3 })])
  })
})
