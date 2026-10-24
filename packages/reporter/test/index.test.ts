import type { FullConfig, FullResult, Suite, TestCase } from '@playwright/test/reporter'
import { Buffer } from 'node:buffer'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { makeTestKey } from '@kinora/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import KinoraReporter from '../src/index'

// Minimal fakes of the Playwright reporter objects the reporter reads.
function fakeTest(over: { title?: string, outcome?: string, ok?: boolean, tracePath?: string, videoPath?: string, attachments?: { name: string, contentType: string, body?: Buffer, path?: string }[] } = {}): TestCase {
  const projectSuite = { type: 'project', title: 'chromium', parent: undefined }
  const fileSuite = { type: 'file', title: 'a.spec.ts', parent: projectSuite }
  const attachments = [
    ...over.tracePath ? [{ name: 'trace', contentType: 'application/zip', path: over.tracePath }] : [],
    ...over.videoPath ? [{ name: 'video', contentType: 'video/webm', path: over.videoPath }] : [],
    ...over.attachments ?? [],
  ]
  return {
    parent: fileSuite,
    title: over.title ?? 'passes',
    location: { file: 'a.spec.ts', line: 3, column: 1 },
    results: [{ duration: 5, errors: [], attachments }],
    outcome: () => over.outcome ?? 'expected',
    ok: () => over.ok ?? true,
    tags: ['@smoke'],
    annotations: [],
  } as unknown as TestCase
}

const GH_VARS = ['GITHUB_ACTIONS', 'GITHUB_SHA', 'GITHUB_REF_NAME', 'GITHUB_HEAD_REF', 'GITHUB_SERVER_URL', 'GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_RUN_NUMBER', 'GITHUB_TOKEN', 'GITHUB_EVENT_NAME', 'GITHUB_EVENT_PATH', 'GITHUB_REF', 'GITHUB_BASE_REF', 'GITHUB_API_URL']

const GL_VARS = ['GITLAB_CI', 'CI_COMMIT_SHA', 'CI_COMMIT_REF_NAME', 'CI_PROJECT_URL', 'CI_PIPELINE_URL', 'CI_PIPELINE_IID', 'CI_MERGE_REQUEST_SOURCE_BRANCH_NAME', 'CI_MERGE_REQUEST_TARGET_BRANCH_NAME']

const SHARD_VARS = ['KINORA_GROUP_KEY', 'KINORA_ATTEMPT', 'GITHUB_RUN_ATTEMPT', 'CI_PIPELINE_ID', 'CI_JOB_ID']

function fakeSuite(tests: TestCase[]): Suite {
  return { allTests: () => tests } as unknown as Suite
}

function fakeResult(): FullResult {
  return { startTime: new Date('2026-01-01T00:00:00.000Z'), duration: 1000, status: 'passed' } as FullResult
}

afterEach(() => {
  vi.unstubAllGlobals()
  for (const v of [...GH_VARS, ...GL_VARS, ...SHARD_VARS]) delete process.env[v]
})

describe('reporter a11y', () => {
  const axe = (violations: unknown[]) => JSON.stringify({ testEngine: { name: 'axe-core', version: '4.10.2' }, violations, passes: [{ id: 'region', nodes: [{ html: '<main>' }] }] })
  const buttonName = { id: 'button-name', impact: 'critical', help: 'Buttons must have discernible text', helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name', nodes: [{ target: ['#save'], html: '<button id="save">' }] }
  const contrast = { id: 'color-contrast', impact: 'serious', help: 'Elements must meet minimum color contrast ratio thresholds', helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast', nodes: [{ target: ['.muted'] }, { target: ['.hint'] }] }

  async function upload(test: TestCase) {
    let body = ''
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
      body = init.body as string
      return new Response(JSON.stringify({ projectId: 'p', runId: 'r', tests: 1 }), { status: 201 })
    }))
    const reporter = new KinoraReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'web-app' } })
    reporter.onBegin({ version: '1.60.0' } as FullConfig, fakeSuite([test]))
    await reporter.onEnd(fakeResult())
    return JSON.parse(body).tests[0]
  }

  it('reads the axe scans attached to a test, from a body or a file, and keeps only their violations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kinora-a11y-'))
    const file = join(dir, 'scan.json')
    await writeFile(file, axe([contrast, buttonName]))
    try {
      const t = await upload(fakeTest({
        attachments: [
          { name: 'accessibility-scan-results', contentType: 'application/json', body: Buffer.from(axe([buttonName])) },
          { name: 'checkout scan', contentType: 'application/json', path: file },
          { name: 'api-response', contentType: 'application/json', body: Buffer.from('{"violations":[1]}') },
        ],
      }))
      // A test that still passes: warnings. Each rule once across the scans, most severe first.
      expect(t.a11y.status).toBe('warning')
      expect(t.a11y.violations.map((v: { id: string, nodes: string[] }) => [v.id, v.nodes])).toEqual([['button-name', ['#save']], ['color-contrast', ['.muted', '.hint']]])
      expect(JSON.stringify(t.a11y)).not.toContain('<button')
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('marks the check failed when the test failed, passed when a scan found nothing, absent without a scan', async () => {
    const scan = (violations: unknown[]) => [{ name: 'a11y', contentType: 'application/json', body: Buffer.from(axe(violations)) }]
    expect((await upload(fakeTest({ outcome: 'unexpected', ok: false, attachments: scan([buttonName]) }))).a11y.status).toBe('failed')
    expect((await upload(fakeTest({ attachments: scan([]) }))).a11y).toEqual({ status: 'passed', violations: [] })
    expect((await upload(fakeTest())).a11y).toBeUndefined()
  })
})

describe('reporter onEnd', () => {
  it('uploads a normalized run with a stable testKey and counts', async () => {
    let body = ''
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      body = init.body as string
      return new Response(JSON.stringify({ projectId: 'p', runId: 'r', tests: 1 }), { status: 201 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const reporter = new KinoraReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'web-app' } })
    reporter.onBegin({ version: '1.60.0' } as FullConfig, fakeSuite([fakeTest()]))
    await reporter.onEnd(fakeResult())

    expect(fetchMock).toHaveBeenCalledOnce()
    const payload = JSON.parse(body)
    expect(payload.tests[0].testKey).toBe(makeTestKey('a.spec.ts', ['a.spec.ts', 'passes'], 'chromium'))
    expect(payload.run.counts).toMatchObject({ total: 1, expected: 1 })
    expect(payload.run.playwrightVersion).toBe('1.60.0')
    expect(payload.project).toEqual({ slug: 'web-app', name: 'web-app' })
  })

  it('includes describe titles in the testKey, outermost first', async () => {
    let body = ''
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
      body = init.body as string
      return new Response(JSON.stringify({ projectId: 'p', runId: 'r', tests: 1 }), { status: 201 })
    }))

    const test = fakeTest()
    const outer = { type: 'describe', title: 'checkout', parent: test.parent }
    const inner = { type: 'describe', title: 'guest', parent: outer }
    const nested = { ...test, parent: inner } as unknown as TestCase

    const reporter = new KinoraReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'web-app' } })
    reporter.onBegin({ version: '1.60.0' } as FullConfig, fakeSuite([nested]))
    await reporter.onEnd(fakeResult())

    const payload = JSON.parse(body)
    expect(payload.tests[0].titlePath).toEqual(['a.spec.ts', 'checkout', 'guest', 'passes'])
    expect(payload.tests[0].testKey).toBe(makeTestKey('a.spec.ts', ['a.spec.ts', 'checkout', 'guest', 'passes'], 'chromium'))
  })

  it('skips the upload entirely when no token is configured', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    delete process.env.KINORA_TOKEN

    const reporter = new KinoraReporter({ url: 'https://api.example.com', project: { slug: 'web-app' } })
    reporter.onBegin({ version: '1.60.0' } as FullConfig, fakeSuite([fakeTest()]))
    await reporter.onEnd(fakeResult())

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('counts a failing test as unexpected', async () => {
    let body = ''
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
      body = init.body as string
      return new Response(JSON.stringify({ projectId: 'p', runId: 'r', tests: 1 }), { status: 201 })
    }))

    const reporter = new KinoraReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'web-app' } })
    reporter.onBegin({ version: '1.60.0' } as FullConfig, fakeSuite([fakeTest({ title: 'fails', outcome: 'unexpected', ok: false })]))
    await reporter.onEnd(fakeResult())

    const payload = JSON.parse(body)
    expect(payload.run.counts).toMatchObject({ total: 1, unexpected: 1 })
  })

  it('attaches git + ci metadata detected from the GitHub Actions env', async () => {
    let body = ''
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
      body = init.body as string
      return new Response(JSON.stringify({ projectId: 'p', runId: 'r', tests: 1 }), { status: 201 })
    }))
    process.env.GITHUB_ACTIONS = 'true'
    process.env.GITHUB_SHA = 'abc123'
    process.env.GITHUB_REF_NAME = 'main'
    // Empty on push events; a real pull_request CI run sets it to the PR branch, which would win over GITHUB_REF_NAME.
    process.env.GITHUB_HEAD_REF = ''
    process.env.GITHUB_SERVER_URL = 'https://github.com'
    process.env.GITHUB_REPOSITORY = 'kinora-dev/kinora'
    process.env.GITHUB_RUN_ID = '42'
    process.env.GITHUB_RUN_NUMBER = '7'

    const reporter = new KinoraReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'web-app' } })
    reporter.onBegin({ version: '1.60.0' } as FullConfig, fakeSuite([fakeTest()]))
    await reporter.onEnd(fakeResult())

    const payload = JSON.parse(body)
    expect(payload.run.git).toMatchObject({ sha: 'abc123', branch: 'main', repoUrl: 'https://github.com/kinora-dev/kinora' })
    expect(payload.run.ci).toMatchObject({ provider: 'github', runUrl: 'https://github.com/kinora-dev/kinora/actions/runs/42', runNumber: '7' })
  })

  it('attaches git + ci metadata detected from a GitLab merge request pipeline', async () => {
    let body = ''
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
      body = init.body as string
      return new Response(JSON.stringify({ projectId: 'p', runId: 'r', tests: 1 }), { status: 201 })
    }))
    process.env.GITLAB_CI = 'true'
    process.env.CI_COMMIT_SHA = 'def456'
    process.env.CI_COMMIT_REF_NAME = 'feat/login'
    process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME = 'feat/login'
    process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME = 'main'
    process.env.CI_PROJECT_URL = 'https://gitlab.com/kinora-dev/kinora'
    process.env.CI_PIPELINE_URL = 'https://gitlab.com/kinora-dev/kinora/-/pipelines/901'
    process.env.CI_PIPELINE_IID = '12'

    const reporter = new KinoraReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'web-app' } })
    reporter.onBegin({ version: '1.60.0' } as FullConfig, fakeSuite([fakeTest()]))
    await reporter.onEnd(fakeResult())

    const payload = JSON.parse(body)
    expect(payload.run.git).toMatchObject({ sha: 'def456', branch: 'feat/login', baseBranch: 'main', repoUrl: 'https://gitlab.com/kinora-dev/kinora' })
    expect(payload.run.ci).toMatchObject({ provider: 'gitlab', runUrl: 'https://gitlab.com/kinora-dev/kinora/-/pipelines/901', runNumber: '12' })
  })

  it('uploads a trace attachment after the run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kinora-reporter-'))
    const tracePath = join(dir, 'trace.zip')
    await writeFile(tracePath, Buffer.from('PK'))
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      urls.push(String(url))
      return new Response(JSON.stringify({ projectId: 'p', runId: 'r', tests: 1, url: 'http://x/a.zip' }), { status: 201 })
    }))

    const reporter = new KinoraReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'web-app' } })
    reporter.onBegin({ version: '1.60.0' } as FullConfig, fakeSuite([fakeTest({ tracePath })]))
    await reporter.onEnd(fakeResult())

    expect(urls).toContain('https://api.example.com/api/v1/runs')
    expect(urls.some(u => u.endsWith('/artifacts'))).toBe(true)
    await rm(dir, { recursive: true, force: true })
  })

  it('leaves a video on the runner unless uploadAttachments asks for it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kinora-reporter-'))
    const videoPath = join(dir, 'video.webm')
    await writeFile(videoPath, Buffer.from('webm'))
    const artifactPosts = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).endsWith('/artifacts'))
        artifactPosts()
      return new Response(JSON.stringify({ projectId: 'p', runId: 'r', tests: 1, url: 'http://x/a.webm' }), { status: 201 })
    }))

    const reporter = new KinoraReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'web-app' } })
    reporter.onBegin({ version: '1.60.0' } as FullConfig, fakeSuite([fakeTest({ videoPath })]))
    await reporter.onEnd(fakeResult())
    expect(artifactPosts).not.toHaveBeenCalled()

    const withVideo = new KinoraReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'web-app' }, uploadAttachments: ['trace', 'video'] })
    withVideo.onBegin({ version: '1.60.0' } as FullConfig, fakeSuite([fakeTest({ videoPath })]))
    await withVideo.onEnd(fakeResult())
    expect(artifactPosts).toHaveBeenCalledTimes(1)

    await rm(dir, { recursive: true, force: true })
  })

  it('does not throw when the server rejects with a plan-limit 402', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'limit reached' }), { status: 402 })))

    const reporter = new KinoraReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'web-app' } })
    reporter.onBegin({ version: '1.60.0' } as FullConfig, fakeSuite([fakeTest()]))
    await expect(reporter.onEnd(fakeResult())).resolves.toBeUndefined()
  })

  it('does not throw on a non-402 server error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))

    const reporter = new KinoraReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'web-app' } })
    reporter.onBegin({ version: '1.60.0' } as FullConfig, fakeSuite([fakeTest()]))
    await expect(reporter.onEnd(fakeResult())).resolves.toBeUndefined()
  })

  it('retries while the server is down and warns about each wait', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++
      if (calls === 1)
        return new Response('Service Unavailable', { status: 503 })
      return new Response(JSON.stringify({ projectId: 'p', runId: 'r', tests: 1 }), { status: 201 })
    }))

    const reporter = new KinoraReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'web-app' } })
    reporter.onBegin({ version: '1.60.0' } as FullConfig, fakeSuite([fakeTest()]))
    const done = reporter.onEnd(fakeResult())
    await vi.runAllTimersAsync()
    await done
    vi.useRealTimers()

    expect(calls).toBe(2)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[kinora\] kinora server unavailable \(HTTP 503\), retrying in 1s$/))
    warn.mockRestore()
  })

  it('posts a GitHub PR comment when prComment is enabled on a pull_request', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url)
      calls.push(`${init?.method ?? 'GET'} ${u}`)
      if (u.includes('/api/v1/runs'))
        return new Response(JSON.stringify({ projectId: 'p', runId: 'r', tests: 1, runUrl: 'https://app.kinora.dev/x' }), { status: 201 })
      // GitHub: list comments (GET) -> none; create (POST) -> ok
      return new Response(JSON.stringify(init?.method === 'POST' ? {} : []), { status: init?.method === 'POST' ? 201 : 200 })
    }))
    process.env.GITHUB_TOKEN = 'ghtok'
    process.env.GITHUB_EVENT_NAME = 'pull_request'
    process.env.GITHUB_REPOSITORY = 'acme/app'
    process.env.GITHUB_REF = 'refs/pull/9/merge'
    process.env.GITHUB_EVENT_PATH = '/nonexistent/event.json' // exercises the injected file reader + its catch

    const reporter = new KinoraReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'web-app' }, prComment: true })
    reporter.onBegin({ version: '1.60.0' } as FullConfig, fakeSuite([fakeTest()]))
    await reporter.onEnd(fakeResult())

    expect(calls.some(c => c.startsWith('POST') && c.includes('api.github.com/repos/acme/app/issues/9/comments'))).toBe(true)
  })

  it('names the run\'s flaky tests in the PR comment', async () => {
    let comment = ''
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).includes('/api/v1/runs'))
        return new Response(JSON.stringify({ projectId: 'p', runId: 'r', tests: 2 }), { status: 201 })
      if (init?.method === 'POST')
        comment = JSON.parse(init.body as string).body
      return new Response(JSON.stringify(init?.method === 'POST' ? {} : []), { status: init?.method === 'POST' ? 201 : 200 })
    }))
    process.env.GITHUB_TOKEN = 'ghtok'
    process.env.GITHUB_EVENT_NAME = 'pull_request'
    process.env.GITHUB_REPOSITORY = 'acme/app'
    process.env.GITHUB_REF = 'refs/pull/9/merge'

    const reporter = new KinoraReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'web-app' }, prComment: true })
    reporter.onBegin({ version: '1.60.0' } as FullConfig, fakeSuite([fakeTest({ title: 'pays with a card', outcome: 'flaky' }), fakeTest({ title: 'shows the cart' })]))
    await reporter.onEnd(fakeResult())

    expect(comment).toContain('**1 flaky**:\n- `a.spec.ts` › `pays with a card`')
    expect(comment).not.toContain('shows the cart')
  })

  describe('sharded runs', () => {
    // A CI runner sets these itself: start every test without them.
    beforeEach(() => {
      for (const v of [...GH_VARS, ...GL_VARS, ...SHARD_VARS]) delete process.env[v]
    })

    const shardConfig = { version: '1.60.0', shard: { current: 2, total: 3 } } as FullConfig

    function stubServer(runResponse: object) {
      const sent: { run?: Record<string, unknown>, comments: string[] } = { comments: [] }
      vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
        if (String(url).includes('/api/v1/runs')) {
          sent.run = JSON.parse(init!.body as string).run
          return new Response(JSON.stringify({ projectId: 'p', runId: 'r', tests: 1, ...runResponse }), { status: 201 })
        }
        if (init?.method === 'POST')
          sent.comments.push(JSON.parse(init.body as string).body)
        return new Response(JSON.stringify(init?.method === 'POST' ? {} : []), { status: init?.method === 'POST' ? 201 : 200 })
      }))
      return sent
    }

    function onPullRequest() {
      process.env.GITHUB_TOKEN = 'ghtok'
      process.env.GITHUB_EVENT_NAME = 'pull_request'
      process.env.GITHUB_REPOSITORY = 'acme/app'
      process.env.GITHUB_REF = 'refs/pull/9/merge'
    }

    it('groups a shard by the CI run, with its attempt and slot', async () => {
      const sent = stubServer({ status: 'open' })
      process.env.GITHUB_RUN_ID = '42'
      process.env.GITHUB_RUN_ATTEMPT = '2'

      const reporter = new KinoraReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'web-app' } })
      reporter.onBegin(shardConfig, fakeSuite([fakeTest()]))
      await reporter.onEnd(fakeResult())

      expect(sent.run).toMatchObject({ groupKey: 'gh-42', attempt: 2, shard: { current: 2, total: 3 } })
    })

    it('takes an explicit group key and tells matrix legs apart by the PR comment label', async () => {
      const sent = stubServer({ status: 'open' })
      process.env.KINORA_GROUP_KEY = 'from-env'

      const reporter = new KinoraReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'web-app' }, groupKey: 'nightly-7', prComment: { label: 'firefox' } })
      reporter.onBegin(shardConfig, fakeSuite([fakeTest()]))
      await reporter.onEnd(fakeResult())

      expect(sent.run?.groupKey).toBe('nightly-7:firefox')
    })

    it('uploads a shard on its own without a CI run id, or when grouping is off', async () => {
      const sent = stubServer({})
      const reporter = new KinoraReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'web-app' } })
      reporter.onBegin(shardConfig, fakeSuite([fakeTest()]))
      await reporter.onEnd(fakeResult())
      expect(sent.run).not.toHaveProperty('groupKey')

      process.env.GITHUB_RUN_ID = '42'
      const off = new KinoraReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'web-app' }, groupKey: false })
      off.onBegin(shardConfig, fakeSuite([fakeTest()]))
      await off.onEnd(fakeResult())
      expect(sent.run).not.toHaveProperty('groupKey')
    })

    it('updates the PR comment on every shard with the shards landed so far, then the whole run', async () => {
      onPullRequest()
      process.env.GITHUB_RUN_ID = '42'
      const pending = stubServer({
        status: 'open',
        shardProgress: { landed: 1, total: 3 },
        counts: { total: 1, expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
      })
      const first = new KinoraReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'web-app' }, prComment: true })
      first.onBegin(shardConfig, fakeSuite([fakeTest()]))
      await first.onEnd(fakeResult())
      expect(pending.comments).toHaveLength(1)
      expect(pending.comments[0]).toContain('⏳ **kinora** · web-app · 1 of 3 shards landed')

      const done = stubServer({
        status: 'complete',
        shardProgress: { landed: 3, total: 3 },
        counts: { total: 3, expected: 2, unexpected: 0, flaky: 1, skipped: 0 },
        flaky: [{ testKey: 'k', title: 'pays with a card', file: 'b.spec.ts', rerunAttempt: 2 }],
      })
      const last = new KinoraReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'web-app' }, prComment: true })
      last.onBegin(shardConfig, fakeSuite([fakeTest()]))
      await last.onEnd(fakeResult())
      expect(done.comments).toHaveLength(1)
      expect(done.comments[0]).toContain('`3/3 passed`')
      expect(done.comments[0]).toContain('**1 flaky**:\n- `b.spec.ts` › `pays with a card` · passed on re-run (attempt 2)')
    })

    it('skips the PR comment of a grouped shard when the server predates grouping', async () => {
      onPullRequest()
      process.env.GITHUB_RUN_ID = '42'
      const sent = stubServer({})
      const reporter = new KinoraReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'web-app' }, prComment: true })
      reporter.onBegin(shardConfig, fakeSuite([fakeTest()]))
      await reporter.onEnd(fakeResult())
      expect(sent.comments).toEqual([])
    })

    it('still skips the PR comment on an ungrouped shard, left to the merged report', async () => {
      onPullRequest()
      const sent = stubServer({})
      const reporter = new KinoraReporter({ url: 'https://api.example.com', token: 't', project: { slug: 'web-app' }, prComment: true })
      reporter.onBegin(shardConfig, fakeSuite([fakeTest()]))
      await reporter.onEnd(fakeResult())
      expect(sent.comments).toEqual([])
    })
  })
})
