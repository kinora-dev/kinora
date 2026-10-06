import type { FullConfig, FullResult, Suite, TestCase } from '@playwright/test/reporter'
import { Buffer } from 'node:buffer'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { makeTestKey } from '@kinora/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import KinoraReporter from '../src/index'

// Minimal fakes of the Playwright reporter objects the reporter reads.
function fakeTest(over: { title?: string, outcome?: string, ok?: boolean, tracePath?: string, videoPath?: string } = {}): TestCase {
  const projectSuite = { type: 'project', title: 'chromium', parent: undefined }
  const fileSuite = { type: 'file', title: 'a.spec.ts', parent: projectSuite }
  const attachments = [
    ...over.tracePath ? [{ name: 'trace', contentType: 'application/zip', path: over.tracePath }] : [],
    ...over.videoPath ? [{ name: 'video', contentType: 'video/webm', path: over.videoPath }] : [],
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

const GH_VARS = ['GITHUB_ACTIONS', 'GITHUB_SHA', 'GITHUB_REF_NAME', 'GITHUB_SERVER_URL', 'GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_RUN_NUMBER', 'GITHUB_TOKEN', 'GITHUB_EVENT_NAME', 'GITHUB_EVENT_PATH', 'GITHUB_REF', 'GITHUB_BASE_REF', 'GITHUB_API_URL']

const GL_VARS = ['GITLAB_CI', 'CI_COMMIT_SHA', 'CI_COMMIT_REF_NAME', 'CI_PROJECT_URL', 'CI_PIPELINE_URL', 'CI_PIPELINE_IID', 'CI_MERGE_REQUEST_SOURCE_BRANCH_NAME', 'CI_MERGE_REQUEST_TARGET_BRANCH_NAME']

function fakeSuite(tests: TestCase[]): Suite {
  return { allTests: () => tests } as unknown as Suite
}

function fakeResult(): FullResult {
  return { startTime: new Date('2026-01-01T00:00:00.000Z'), duration: 1000, status: 'passed' } as FullResult
}

afterEach(() => {
  vi.unstubAllGlobals()
  for (const v of [...GH_VARS, ...GL_VARS]) delete process.env[v]
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
})
