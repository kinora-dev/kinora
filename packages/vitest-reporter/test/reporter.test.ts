import type { Vitest } from 'vitest/node'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import KinoraVitestReporter from '../src/index'
import { fakeModule, fakeTest } from './fakes'

interface Call { url: string, body: unknown }

// Fake kinora server: records each request, answers the run upload, then artifact uploads.
function stubServer(status = 201): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: init.body })
    if (String(url).endsWith('/artifacts'))
      return new Response(JSON.stringify({ url: 'https://x/a' }), { status: 201 })
    return status === 201
      ? new Response(JSON.stringify({ projectId: 'p', runId: 'run-1', tests: 1 }), { status: 201 })
      : new Response(JSON.stringify({ error: 'Plan limit reached' }), { status })
  }))
  return calls
}

function reporter(options: Partial<ConstructorParameters<typeof KinoraVitestReporter>[0]> = {}) {
  return new KinoraVitestReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'ui' }, ...options })
}

const CI_VARS = ['KINORA_GROUP_KEY', 'KINORA_ATTEMPT', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'CI_PIPELINE_ID', 'CI_JOB_ID', 'GITHUB_ACTIONS', 'GITHUB_TOKEN', 'GITHUB_EVENT_NAME', 'GITHUB_EVENT_PATH', 'GITHUB_REPOSITORY', 'GITHUB_REF', 'GITHUB_SHA', 'GITHUB_BASE_REF', 'GITHUB_HEAD_REF', 'GITHUB_REF_NAME', 'GITHUB_SERVER_URL', 'GITHUB_API_URL', 'GITLAB_CI']

// A CI runner sets these itself: start every test without them.
beforeEach(() => {
  for (const v of CI_VARS) delete process.env[v]
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const v of CI_VARS) delete process.env[v]
})

describe('onInit', () => {
  it('turns on test locations for the run and every project', () => {
    const projects = [{ config: {} }, { config: {} }]
    const vitest = { config: {}, projects } as unknown as Vitest
    reporter().onInit(vitest)
    expect((vitest.config as { includeTaskLocation?: boolean }).includeTaskLocation).toBe(true)
    expect(projects.every(p => (p.config as { includeTaskLocation?: boolean }).includeTaskLocation)).toBe(true)
  })
})

describe('onTestRunEnd', () => {
  it('uploads the browser tests of the run with their counts', async () => {
    const calls = stubServer()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await reporter().onTestRunEnd([fakeModule([
      fakeTest({ name: 'passes' }),
      fakeTest({ name: 'fails', state: 'failed' }),
      fakeTest({ name: 'adds', browser: false, project: 'unit' }),
    ])])

    expect(calls).toHaveLength(1)
    const payload = JSON.parse(calls[0].body as string)
    expect(payload.project).toEqual({ slug: 'ui', name: 'ui' })
    expect(payload.tests.map((t: { title: string }) => t.title)).toEqual(['passes', 'fails'])
    expect(payload.run.counts).toMatchObject({ total: 2, expected: 1, unexpected: 1 })
  })

  it('uploads the trace of a test after the run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kinora-vitest-'))
    const trace = join(dir, 'x.trace.zip')
    await writeFile(trace, 'zip')
    try {
      const calls = stubServer()
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      await reporter().onTestRunEnd([fakeModule([fakeTest({ annotations: [{ type: 'traces', message: 'x', attachment: { path: trace } }] })])])

      expect(calls.map(c => c.url.replace('https://api.example.com', ''))).toEqual(['/api/v1/runs', '/api/v1/runs/run-1/artifacts'])
      expect(log.mock.calls.flat().join(' ')).toContain('uploaded 1 tests + 1 artifacts')
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('explains why nothing was uploaded from a Node-only run, and uploads it with include: all', async () => {
    const calls = stubServer()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const run = [fakeModule([fakeTest({ browser: false, project: 'unit' })])]

    await reporter().onTestRunEnd(run)
    expect(calls).toHaveLength(0)
    expect(warn.mock.calls.flat().join(' ')).toContain('no browser tests in this run (1 Node tests left out)')

    await reporter({ include: 'all' }).onTestRunEnd(run)
    expect(calls).toHaveLength(1)
  })

  it('skips the upload without a token', async () => {
    const calls = stubServer()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const token = process.env.KINORA_TOKEN
    delete process.env.KINORA_TOKEN
    try {
      await reporter({ token: undefined }).onTestRunEnd([fakeModule([fakeTest()])])
    }
    finally {
      if (token !== undefined)
        process.env.KINORA_TOKEN = token
    }
    expect(calls).toHaveLength(0)
    expect(warn.mock.calls.flat().join(' ')).toContain('missing token')
  })

  it('never fails the test run when the server refuses the upload', async () => {
    stubServer(402)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(reporter().onTestRunEnd([fakeModule([fakeTest()])])).resolves.toBeUndefined()
    expect(warn.mock.calls.flat().join(' ')).toContain('Plan limit reached')
  })
})

describe('sharded runs', () => {
  function shardedReporter(options: Partial<ConstructorParameters<typeof KinoraVitestReporter>[0]> = {}, shard = { index: 2, count: 3 }) {
    const r = reporter(options)
    r.onInit({ config: { shard }, projects: [] } as unknown as Vitest)
    return r
  }

  it('groups a shard by the CI run, with its attempt and slot', async () => {
    const calls = stubServer()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    process.env.GITHUB_RUN_ID = '42'
    process.env.GITHUB_RUN_ATTEMPT = '2'
    await shardedReporter().onTestRunEnd([fakeModule([fakeTest()])])

    expect(JSON.parse(calls[0].body as string).run).toMatchObject({ groupKey: 'gh-42', attempt: 2, shard: { current: 2, total: 3 } })
  })

  it('takes an explicit group key from the option', async () => {
    const calls = stubServer()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    process.env.GITHUB_RUN_ID = '42'
    await shardedReporter({ groupKey: 'nightly-7:firefox' }).onTestRunEnd([fakeModule([fakeTest()])])

    expect(JSON.parse(calls[0].body as string).run.groupKey).toBe('nightly-7:firefox')
  })

  it('uploads a shard on its own without a CI run id, when grouping is off, or without --shard', async () => {
    const calls = stubServer()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await shardedReporter().onTestRunEnd([fakeModule([fakeTest()])])

    process.env.GITHUB_RUN_ID = '42'
    await shardedReporter({ groupKey: false }).onTestRunEnd([fakeModule([fakeTest()])])
    await reporter().onTestRunEnd([fakeModule([fakeTest()])])

    expect(calls).toHaveLength(3)
    for (const call of calls)
      expect(JSON.parse(call.body as string).run).not.toHaveProperty('groupKey')
  })

  it('still fills the slot of a shard that ran no browser test, or the run would never complete', async () => {
    const calls = stubServer()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.GITHUB_RUN_ID = '42'
    await shardedReporter().onTestRunEnd([fakeModule([fakeTest({ browser: false, project: 'unit' })])])

    expect(calls).toHaveLength(1)
    const { run, tests } = JSON.parse(calls[0].body as string)
    expect(tests).toEqual([])
    expect(run).toMatchObject({ groupKey: 'gh-42', shard: { current: 2, total: 3 }, counts: { total: 0 } })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('filling its slot'))
  })

  it('shows the shards landed so far', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ projectId: 'p', runId: 'run-1', tests: 1, status: 'open', shardProgress: { landed: 2, total: 3 } }), { status: 201 })))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.env.GITHUB_RUN_ID = '42'
    await shardedReporter().onTestRunEnd([fakeModule([fakeTest()])])

    expect(log).toHaveBeenCalledWith(expect.stringContaining('2 of 3 shards'))
  })
})

describe('pull requests', () => {
  let dir: string

  // A pull_request run: the event payload carries the PR number and its head commit.
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kinora-vitest-pr-'))
    const eventPath = join(dir, 'event.json')
    await writeFile(eventPath, JSON.stringify({ pull_request: { number: 9, head: { sha: 'headsha' } } }))
    Object.assign(process.env, { GITHUB_TOKEN: 'ghtok', GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: 'acme/ui', GITHUB_SHA: 'mergesha', GITHUB_BASE_REF: 'main', GITHUB_EVENT_PATH: eventPath })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  // kinora answers the run with a regression; GitHub lists no comment yet and accepts the writes.
  function stubPr(run: object = {}): { method: string, url: string, body?: string }[] {
    const calls: { method: string, url: string, body?: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      calls.push({ method: init?.method ?? 'GET', url: u, body: init?.body as string | undefined })
      if (u.includes('/api/v1/runs'))
        return new Response(JSON.stringify({ projectId: 'p', runId: 'run-1', tests: 2, runUrl: 'https://app.kinora.dev/r', regression: { base: 'base-branch', newlyFailing: [{ testKey: 'k', title: 'fails', file: 'a.test.ts' }], newlyFlaky: [], fixed: 0 }, ...run }), { status: 201 })
      return new Response(init?.method === 'POST' ? '{}' : '[]', { status: init?.method === 'POST' ? 201 : 200 })
    }))
    return calls
  }

  const run = () => [fakeModule([fakeTest({ name: 'passes' }), fakeTest({ name: 'fails', state: 'failed' })])]

  it('posts the comment and the commit status, asking kinora for the regression', async () => {
    const calls = stubPr()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await reporter({ prComment: true, prStatus: true }).onTestRunEnd(run())

    expect(calls[0].url).toContain('regression=1')
    const comment = calls.find(c => c.method === 'POST' && c.url === 'https://api.github.com/repos/acme/ui/issues/9/comments')
    expect(JSON.parse(comment!.body!).body).toContain('1 newly failing** vs base branch')
    const status = calls.find(c => c.url === 'https://api.github.com/repos/acme/ui/statuses/headsha')
    expect(JSON.parse(status!.body!)).toMatchObject({ state: 'failure', context: 'kinora / ui', description: '1 newly failing vs main', target_url: 'https://app.kinora.dev/r' })
    expect(warn.mock.calls.flat()).toEqual(expect.arrayContaining(['[kinora] PR comment created', '[kinora] PR status posted']))
  })

  it('posts nothing to the PR unless asked', async () => {
    const calls = stubPr()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await reporter().onTestRunEnd(run())

    expect(calls).toHaveLength(1)
    expect(calls[0].url).not.toContain('regression')
  })

  it('keeps matrix legs apart: their own status, and their own run when sharded', async () => {
    const calls = stubPr({ shardProgress: { landed: 3, total: 3 } })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.GITHUB_RUN_ID = '42'
    const r = reporter({ prStatus: { label: 'firefox' } })
    r.onInit({ config: { shard: { index: 3, count: 3 } }, projects: [] } as unknown as Vitest)
    await r.onTestRunEnd(run())

    expect(JSON.parse(calls[0].body!).run.groupKey).toBe('gh-42:firefox')
    const status = calls.find(c => c.url.endsWith('/statuses/headsha'))
    expect(JSON.parse(status!.body!).context).toBe('kinora / ui (firefox)')
  })

  it('leaves the PR alone when a shard is uploaded as a run of its own', async () => {
    const calls = stubPr()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const r = reporter({ prStatus: true, groupKey: false })
    r.onInit({ config: { shard: { index: 1, count: 3 } }, projects: [] } as unknown as Vitest)
    await r.onTestRunEnd(run())

    expect(calls.filter(c => c.url.includes('api.github.com'))).toEqual([])
  })

  it('never fails the test run when GitHub refuses the status', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('/api/v1/runs')
      ? new Response(JSON.stringify({ projectId: 'p', runId: 'run-1', tests: 2 }), { status: 201 })
      : new Response('boom', { status: 500 })))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(reporter({ prStatus: true }).onTestRunEnd(run())).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledWith('[kinora] PR status failed: github: create status failed (500)')
  })
})
